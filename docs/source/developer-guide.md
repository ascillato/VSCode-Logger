# Developer Setup and Workflow

This extension welcomes contributions from the community. Please review the [CONTRIBUTING guide](code-development.md) before opening a pull request.

## Source code and documentation

- Repository: 
- Architecture and docs site: 

## Build and run from source

1. Clone the repository.
2. Install dependencies and compile:
   ```bash
   npm install
   npm run compile
   ```
3. Launch the Extension Development Host with `F5` in VS Code and open the **Extension** view.

## Packaging and installation

- Generate a VSIX (requires `@vscode/vsce`):
  ```bash
  make package
  ```
- Install the generated package locally:
  ```bash
  make install
  ```

## Cleaning and rebuilding

```bash
make clean
make package
make install
```

Or run everything at once:
```bash
make all
```

## Linting and formatting

Install lint dependencies and run checks:
```bash
npm install --save-dev eslint prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-config-prettier eslint-plugin-prettier
make check
```

## Documentation

Install Python requirements and build the docs:
```bash
pip install -r docs/requirements.txt
make docs
```
The generated HTML lives at `docs/build/html/index.html`.

Continuous integration builds and publishes the site from `main` to `gh-pages`.

## How to contribute

- Open issues for bug reports or feature requests.
- Submit pull requests with clear descriptions and tests where applicable.
- Run the standard project checks locally to catch regressions early:
```bash
make check
make package
make docs
```
- Follow the coding and security practices outlined in the [CONTRIBUTING guide](code-development.md)

## Software Release Procedure

The following scheme aims to have a defined test procedure for the software before a release to users is made, so as to catch any bug before deployment.

> **Important:** Pull requests must be opened against the **development** branch. The **main** branch is reserved for releases.

1. Create a branch name with its type of branch (i.e chore, bugfix, feature)
    Format: **feature/Add feature X**
    Use present simple tense (since it is not added to main yet).
    If your changes are just for test and are not final code that will be reviewed, you can use a temporary branch name like: **dev/Add feature X**, until you believe that is ready, then you can put your changes in the final branch: **feature/Add feature X.**
    Remember to remove any temporary branch.

2. Create a pull request from that branch to `development` target branch.
    The format name is the same as the Branch name.
    Make a description in the PR that reflects what changes are being performed and any other relevant information for the reviewer.

3. Commit your changes to your branch. Commit names must be descriptive and in present simple. It should start with a verb like: `Add module`.
    Please, do not put `WIP`, `oops`, or `update filename`.
    If possible, commit often and backup your changes.
    With every commit the CI will run the automated tests. Check if all the tests have passed.

4. Make sure that the PR:
    1. Compiles fine
    2. Works and is performing the intended task(s)
    3. It is free of compiler warnings
    4. It is free of linter errors
    5. All test pass
    6. It has the unit tests if apply.

5. Add Documentation, if apply.

### Merging

Only in certain cases, collaborators are able to push directly to main. No one should push code without it being approved by a PR and passing integration tests.

Merge Strategy is Always **Merge Commit** for merging `development` branch into `main` branch.

For *temporary branches* merging into `development`, if the commit messages have followed the previous name format and are useful for the commit history of the main repository, a **Merge Commit** strategy can be used. If not, use **Merge Squash** as Merge Strategy. The Merge commit message should be the PR name and the commit description should be the PR description or a short description of the changes.
After merging, temporary branches will be **auto-closed** to keep the branches clean in the repository.

### Git Branches Usage

The following development flow based on https://nvie.com/posts/a-successful-git-branching-model/

```mermaid
:zoom: 100%
---
title: Git branches usage
config:
  logLevel: 'debug'
  theme: 'default'
  themeVariables:
      'git0': '#00ff00'
      'git1': '#ff0000'
      'git2': '#0000ff'
      'git3': '#ff00ff'
      'git4': '#00ffff'
      'git5': '#ffff00'
      'git6': '#ff00ff'
      'git7': '#00ffff'
  gitGraph:
    showBranches: true
    showCommitLabel: true
    mainBranchName: 'main'
---
      gitGraph TB:
        commit id: "Initial" tag: "v0.0.0"

        branch develop order: 2
        checkout develop
        commit id: "dev v1.0.0"
        commit id: "a feature"
        commit id: "another feature"

        branch feature1 order: 3
        checkout feature1
        commit id: "part of feature"
        checkout develop
        commit id: "more features"
        checkout feature1
        commit id: "another part"
        checkout develop
        merge feature1

        checkout main
        merge develop tag: "v1.0.0"
        
        checkout main
        branch hotfix order: 1
        checkout hotfix
        commit id: "hotfix"
        checkout main
        merge hotfix tag: "v1.0.1"

        checkout develop
        merge main

        commit id: "dev v1.1.0"

        branch feature2 order: 4
        checkout feature2
        commit id: "part of feature 2"
        checkout develop
        commit id: "feature extra"
        checkout feature2
        commit id: "another part 2"
        checkout develop
        merge feature2

        checkout main
        merge develop tag: "v1.1.0"
```

### Note on TAGs

- Tag shall be added only to `main` branch.
    
- To add a TAG it can be used Github Desktop App or command line (git tag v1.1.23) but all of them directly to main branch. Local branches TAGs may be lost when merging the branch.
    
- To remove a TAG you need to remove it **locally and remotely** by command line:
    git tag -d v1.1.23
    git push --delete origin v1.1.23
    _In case there is a TAG with the same name than a branch, it is needed to specify that only the TAG is needed to be deleted by_ git push --delete :refs/tags/origin v1.1.23

### Permanent Branches

#### Development (Development Branch)

The `development` branch is where all development is merged. This is the branch where all the new features are being worked on. This branch must be used as base for all Pull Requests for **Feature**, **Bugfix**, **Chore** and **Patch** that then are going to be merged into.

Since this project and team is small, no `staging` branch is used. So, the role for **Staging - Under Testing - Release Candidate** takes place in `development` branch. Also the common development cycle:
**Development → Alpha → Beta → RC (Release Candidate) → Release**
is not being used. Instead, from development, when a milestone is reached, new features are stopped and testing is performed. After testing is passed, a merge to main is done to produce a new release:
**Development → Test in Development → Release**

#### Main (Release - Stable Version)

The `main` branch (which is the release branch) is the one that contains the latest stable version that is deployed to the public. This branch never receives a new feature directly. Only hotfixes and the RC (Release Candidate) from `development`.

This branch contains all the releases which can be located by a Version Tag in their correspondent release commit. No special releases will be made which require an independent release branch.

### Temporary Branch Types (work branches)

#### Feature

This branch type is used to develop a new feature to be added to development

#### Bugfix

This branch type is used to fix bugs found in development branch and bugs found in main branch.

#### Patch

This branch type is used to change parameters or code of development that is not a new feature nor a bugfix.

#### Chore

This branch type is used when the change performed to the software won’t change anything from the user side, nor any feature or functionality. It is mainly used when updating libraries, certificates, etc.

### Hotfix

This branch type is used to fix bugs found in release branch.

#### Dev

This branch is used only for the purpose of backup and test a particular code. This is a temporary branch which won’t generate any PR. If the work done on any dev branch is then intended to be merged into development, first a new feature, bugfix or other branch type must be generated with its changes.

### Versioning

The version number format used follows the semantic versioning standard: [https://semver.org/](https://semver.org/)
It consists of v[VERSION_NUMBER]

- **A Version Number:** which is a combination of integer numbers in the format **v**_CORE_VERSION_._MAJOR_._PATCH_ for example: **v1.2.4**.
    This is user and planning focused.
    **This is used for TAGs.**
    
    - Core Version is the current iteration of the project of the actual roadmap
    - Major is the milestone achieved that comprises in a predefined set of features of the roadmap
    - Patch is the number of major changes applied to the Software.
