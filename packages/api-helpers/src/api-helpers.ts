import nodefs from 'fs';
import nodepath from 'path';
import execa, { Options, sync as execaSync, SyncOptions } from 'execa';
import jju from 'jju';
import { RushConfiguration, RushConfigurationProject } from '@microsoft/rush-lib';

export type RushConfigurationOrPath = RushConfiguration | string;
export type RushConfigurationProjectOrPackageName = RushConfigurationProject | string;

export interface RushProjectRecord {
  packageName: string;
  projectFolder: string;
  reviewCategory?: string;
  cyclicDependencyProjects?: string[];
  versionPolicyName?: string;
  shouldPublish?: boolean;
  skipRushCheck?: boolean;
  publishFolder?: string;
}

export type SortProjectsOrder = 'alphabetically' | 'review-category';

export type JsonModifier = (currentJsonParsed: any) => any;

const configCache: Record<string, RushConfiguration> = {};

/**
 *
 */
export function findUpConfigPath(startingPath: string): string {
  if (!startingPath) {
    throw new Error('Rush config starting path must be a non-empty string');
  }

  const path = RushConfiguration.tryFindRushJsonLocation({
    startingFolder: startingPath,
  });

  if (!path) {
    throw new Error(`Rush configuration cannot be found in: ${startingPath}`);
  }

  return path;
}

/**
 *
 */
export function getConfig(configOrPath: RushConfigurationOrPath, force = false): RushConfiguration {
  if (!configOrPath) {
    throw new Error('Rush config must be a string or a RushConfiguration');
  }

  if (typeof configOrPath !== 'string') {
    return configOrPath;
  }

  if (!configCache[configOrPath] || force) {
    const path = findUpConfigPath(configOrPath);

    try {
      configCache[configOrPath] = RushConfiguration.loadFromConfigurationFile(path);
    } catch (e) {
      throw new Error(`Rush configuration at "${path}" cannot be loaded: ${e}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return configCache[configOrPath]!;
}

/**
 *
 */
export function getConfigJsonPath(configOrPath: RushConfigurationOrPath) {
  const path = getConfig(configOrPath).rushJsonFile;

  if (!path) {
    throw new Error(`Rush configuration cannot be found at path "${path}"`);
  }

  return path;
}

/**
 *
 */
export function getReviewCategories(configOrPath: RushConfigurationOrPath): string[] {
  const config = getConfig(configOrPath);

  if (!config?.approvedPackagesPolicy?.reviewCategories) {
    throw new Error(`Rush review categories could not be found`);
  }

  return [...config.approvedPackagesPolicy.reviewCategories];
}

/**
 *
 */
export function getProject(
  configOrPath: RushConfigurationOrPath,
  projectOrName: RushConfigurationProjectOrPackageName,
): RushConfigurationProject {
  if (typeof projectOrName !== 'string') {
    return projectOrName;
  }

  const config = getConfig(configOrPath);

  let project = config.getProjectByName(projectOrName);

  if (project) {
    return project;
  }

  project = config.findProjectByShorthandName(projectOrName);

  if (project) {
    return project;
  }

  throw new Error(`Rush project "${projectOrName}" cannot be found`);
}

/**
 *
 */
function ensureProjectPropertyIsNotEmpty(value: any, property: string): any {
  if (value === undefined) {
    throw new Error(`Rush project property "${property}" has empty value`);
  }
  return value;
}

/**
 *
 */
export function getProjectDir(
  configOrPath: RushConfigurationOrPath,
  projectOrName: RushConfigurationProjectOrPackageName,
): string {
  return ensureProjectPropertyIsNotEmpty(
    getProject(configOrPath, projectOrName).projectFolder,
    'projectFolder',
  );
}

/**
 *
 */
export function getProjectRelativeDir(
  configOrPath: RushConfigurationOrPath,
  projectOrName: RushConfigurationProjectOrPackageName,
) {
  return ensureProjectPropertyIsNotEmpty(
    getProject(configOrPath, projectOrName).projectRelativeFolder,
    'projectRelativeFolder',
  );
}

/**
 *
 */
export function getProjects(configOrPath: RushConfigurationOrPath): RushConfigurationProject[] {
  const config = getConfig(configOrPath);

  if (!config || !Array.isArray(config.projects)) {
    throw new Error(`Rush projects must be an array, found: ${typeof config.projects}`);
  }

  return [...config.projects];
}

/**
 *
 */
export function getProjectsPackageNames(configOrPath: RushConfigurationOrPath): string[] {
  return getProjects(configOrPath).map((project) => project.packageName);
}

/**
 *
 */
export function getProjectsPackageScopes(configOrPath: RushConfigurationOrPath): string[] {
  const scopes = new Set<string>();

  for (const pkgname of getProjectsPackageNames(configOrPath)) {
    const slashPos = pkgname.indexOf('/');

    if (slashPos > 1 && pkgname.indexOf('@') === 0) {
      scopes.add(pkgname.substring(0, slashPos));
    }
  }

  return [...scopes];
}

/**
 *
 */
export function projectExists(configOrPath: RushConfigurationOrPath, packageName: string) {
  return (
    getProjectsPackageNames(configOrPath).map(''.toUpperCase).indexOf(packageName.toUpperCase()) >
    -1
  );
}

/**
 *
 */
function modifyJsonFile(filepath: string, modifier: JsonModifier): void {
  if (!filepath || !nodefs.existsSync(filepath)) {
    throw new Error(`File "${filepath}" does not exist`);
  }

  const content = nodefs.readFileSync(filepath, 'utf-8');

  const parsed = jju.parse(content, { mode: 'cjson' });
  const analyzed = jju.analyze(content, { mode: 'cjson' });

  const modified = jju.update(content, modifier(parsed), {
    mode: 'cjson',
    indent: analyzed.indent,
    quote: analyzed.quote === `'` ? `'` : `"`,
    quote_keys: analyzed.quote_keys,
    no_trailing_comma: true,
  });

  if (content !== modified) {
    nodefs.writeFileSync(filepath, modified);
  }
}

/**
 *
 */
export function modifyConfigFile(
  configOrPath: RushConfigurationOrPath,
  modifier: JsonModifier,
): void {
  modifyJsonFile(getConfigJsonPath(configOrPath), (parsed) => {
    if (!parsed.rushVersion) {
      throw new Error(`Malformed Rush configuration was provided for modification`);
    }
    return modifier(parsed);
  });
}

/**
 *
 */
function alphabeticalSorter(value1: any, value2: any): number {
  const s1 = String(value1).toUpperCase();
  const s2 = String(value2).toUpperCase();
  return s1 < s2 ? -1 : s1 > s2 ? 1 : 0;
}

/**
 *
 */
export function addConfigProject(
  configOrPath: RushConfigurationOrPath,
  project: RushProjectRecord,
  overwrite = false,
  position: number | undefined,
) {
  modifyConfigFile(configOrPath, (parsed) => {
    if (!Array.isArray(parsed?.projects)) {
      parsed.projects = [];
    }

    const existingIndex = parsed.projects.findIndex(
      (p: RushProjectRecord) => p?.packageName && p?.packageName === project?.packageName,
    );

    if (existingIndex > -1) {
      if (overwrite) {
        parsed.projects[existingIndex] = project;
      }
    } else {
      if (position !== undefined) {
        parsed.projects.splice(position, 0, project);
      } else {
        parsed.projects.push(project);
      }
    }

    return parsed;
  });
}

/**
 *
 */
export function sortProjects(
  configOrPath: RushConfigurationOrPath,
  sortOrder: SortProjectsOrder,
): void {
  let sorter: (p1: RushProjectRecord, p2: RushProjectRecord) => number;

  switch (sortOrder) {
    case 'alphabetically':
      sorter = (p1: RushProjectRecord, p2: RushProjectRecord): number =>
        alphabeticalSorter(p1.packageName, p2.packageName);
      break;
    case 'review-category': {
      const reviewCategories = getReviewCategories(configOrPath).map((item) =>
        String(item).toUpperCase(),
      );
      sorter = (p1: RushProjectRecord, p2: RushProjectRecord): number => {
        const cat1 = p1.reviewCategory;
        const cat2 = p2.reviewCategory;

        if (typeof cat1 !== typeof cat2 && (typeof cat1 === 'string' || typeof cat2 == 'string')) {
          // Only one project has review category as string and it will go before uncategorized one
          return typeof cat1 === 'string' ? -1 : 1;
        }

        if (typeof cat1 !== 'string' && typeof cat2 !== 'string') {
          // If both projects have non-string review category consider their priorities are equal
          // So we can sort them using just package names
          return alphabeticalSorter(p1.packageName, p2.packageName);
        }

        const cat1Upper = String(cat1).toUpperCase();
        const cat2Upper = String(cat2).toUpperCase();

        if (cat1Upper === cat2Upper) {
          // Categories are the same
          return alphabeticalSorter(p1.packageName, p2.packageName);
        }

        const pos1 = reviewCategories.indexOf(cat1Upper);
        const pos2 = reviewCategories.indexOf(cat2Upper);

        if (pos1 === pos2) {
          // At this step this should mean unexisting categories for both projects
          return alphabeticalSorter(p1.packageName, p2.packageName);
        }

        return pos1 < pos2 ? -1 : 1;
      };
      break;
    }
  }

  modifyConfigFile(configOrPath, (parsed) => {
    if (!Array.isArray(parsed?.projects)) {
      parsed.projects = [];
    }
    parsed.projects.sort(sorter);
    return parsed;
  });
}

/**
 *
 */
export function execSyncInDir(
  command: string,
  args: string[],
  dir: string,
  execaOptions: SyncOptions = {},
) {
  return execaSync(command, args, {
    cwd: dir,
    ...execaOptions,
  });
}

/**
 *
 */
export function execAsyncInDir(
  command: string,
  args: string[],
  dir: string,
  execaOptions: Options = {},
) {
  return execa(command, args, {
    cwd: dir,
    ...execaOptions,
  });
}

/**
 *
 */
export function execSyncInConfigDir(
  configOrPath: RushConfigurationOrPath,
  command: string,
  args: string[] = [],
  execaOptions: SyncOptions = {},
) {
  return execSyncInDir(
    command,
    args,
    nodepath.dirname(getConfigJsonPath(configOrPath)),
    execaOptions,
  );
}

/**
 *
 */
export function execAsyncRushInConfigDir(
  configOrPath: RushConfigurationOrPath,
  command: string,
  args: string[] = [],
  execaOptions: SyncOptions = {},
) {
  return execAsyncInDir(
    command,
    args,
    nodepath.dirname(getConfigJsonPath(configOrPath)),
    execaOptions,
  );
}

/**
 *
 */
export function execSyncInProjectDir(
  configOrPath: RushConfigurationOrPath,
  projectOrName: RushConfigurationProjectOrPackageName,
  command: string,
  args: string[] = [],
  execaOptions: SyncOptions = {},
) {
  return execSyncInDir(command, args, getProjectDir(configOrPath, projectOrName), execaOptions);
}

/**
 *
 */
export function execAsyncRushInProjectDir(
  configOrPath: RushConfigurationOrPath,
  projectOrName: RushConfigurationProjectOrPackageName,
  command: string,
  args: string[] = [],
  execaOptions: SyncOptions = {},
) {
  return execAsyncInDir(command, args, getProjectDir(configOrPath, projectOrName), execaOptions);
}

/**
 *
 */
export class ApiHelpers {
  /**
   *
   */
  public constructor(private configStartingPath: string) {}

  /**
   *
   */
  public findUpConfigPath() {
    return findUpConfigPath(this.configStartingPath);
  }

  /**
   *
   */
  public getConfig() {
    return getConfig(this.configStartingPath);
  }

  /**
   *
   */
  public getConfigJsonPath() {
    return getConfigJsonPath(this.configStartingPath);
  }

  /**
   *
   */
  public getReviewCategories() {
    return getReviewCategories(this.configStartingPath);
  }

  /**
   *
   */
  public getProject(projectOrName: RushConfigurationProjectOrPackageName) {
    return getProject(this.configStartingPath, projectOrName);
  }

  /**
   *
   */
  public getProjectDir(projectOrName: RushConfigurationProjectOrPackageName) {
    return getProjectDir(this.configStartingPath, projectOrName);
  }

  /**
   *
   */
  public getProjectRelativeDir(projectOrName: RushConfigurationProjectOrPackageName) {
    return getProjectRelativeDir(this.configStartingPath, projectOrName);
  }

  /**
   *
   */
  public getProjects() {
    return getProjects(this.configStartingPath);
  }

  /**
   *
   */
  public getProjectsPackageNames() {
    return getProjectsPackageNames(this.configStartingPath);
  }

  /**
   *
   */
  public getProjectsPackageScopes() {
    return getProjectsPackageScopes(this.configStartingPath);
  }

  /**
   *
   */
  projectExists(packageName: string) {
    return projectExists(this.configStartingPath, packageName);
  }

  /**
   *
   */
  public modifyConfigFile(modifier: JsonModifier) {
    return modifyConfigFile(this.configStartingPath, modifier);
  }

  /**
   *
   */
  public addConfigProject(
    project: RushProjectRecord,
    overwrite = false,
    position: number | undefined,
  ) {
    return addConfigProject(this.configStartingPath, project, overwrite, position);
  }

  /**
   *
   */
  public sortProjects(sortOrder: SortProjectsOrder) {
    return sortProjects(this.configStartingPath, sortOrder);
  }

  /**
   *
   */
  public execSyncInDir(
    command: string,
    args: string[],
    dir: string,
    execaOptions: SyncOptions = {},
  ) {
    return execSyncInDir(command, args, dir, execaOptions);
  }

  /**
   *
   */
  public execAsyncInDir(command: string, args: string[], dir: string, execaOptions: Options = {}) {
    return execAsyncInDir(command, args, dir, execaOptions);
  }

  /**
   *
   */
  public execSyncInConfigDir(command: string, args: string[] = [], execaOptions: SyncOptions = {}) {
    return execSyncInConfigDir(this.configStartingPath, command, args, execaOptions);
  }

  /**
   *
   */
  public execAsyncRushInConfigDir(
    command: string,
    args: string[] = [],
    execaOptions: SyncOptions = {},
  ) {
    return execAsyncRushInConfigDir(this.configStartingPath, command, args, execaOptions);
  }

  /**
   *
   */
  public execSyncInProjectDir(
    projectOrName: RushConfigurationProjectOrPackageName,
    command: string,
    args: string[] = [],
    execaOptions: SyncOptions = {},
  ) {
    return execSyncInProjectDir(
      this.configStartingPath,
      projectOrName,
      command,
      args,
      execaOptions,
    );
  }

  /**
   *
   */
  public execAsyncRushInProjectDir(
    projectOrName: RushConfigurationProjectOrPackageName,
    command: string,
    args: string[] = [],
    execaOptions: SyncOptions = {},
  ) {
    return execAsyncRushInProjectDir(
      this.configStartingPath,
      projectOrName,
      command,
      args,
      execaOptions,
    );
  }
}
