## Commit Convention 🖋️

### **Overview**

Primary purpose is to create an **explicit and structured commit history**, which is essential for writing automated tools, generating release notes, and, critically, aligning directly with **Semantic Versioning (SemVer)** principles.

By adhering to this convention, your commit history clearly communicates the nature, scope, and impact of every change.

---

### **Commit Message Structure (The Formula)**

Every conventional commit **MUST** follow a clear, three-part structure: a header, an optional body, and optional footers.

$$\text{<type>}[\text{optional scope}]\text{!}:\text{<description>}$$
$$[\text{optional body}]$$
$$[\text{optional footer(s)}]$$

#### **Key Structural Elements**

| Element         | Rule         | Description                                                                                                   |
| :-------------- | :----------- | :------------------------------------------------------------------------------------------------------------ |
| **type**        | **REQUIRED** | A noun defining the nature of the change (e.g., `feat`, `fix`).                                               |
| **scope**       | _OPTIONAL_   | A noun in parentheses providing context for a section of the codebase (e.g., `feat(parser)`).                 |
| **\!**          | _OPTIONAL_   | Placed immediately before the colon to **flag a Breaking Change** in the subject line.                        |
| **description** | **REQUIRED** | A concise, short summary of the code change, max 50 characters recommended.                                   |
| **body**        | _OPTIONAL_   | A longer, free-form, and detailed explanation of the change, separated from the header by **one blank line**. |
| **footer(s)**   | _OPTIONAL_   | Used for metadata like issue references (`Closes #123`) and, most importantly, **BREAKING CHANGE** details.   |

---

### **Commit Prefix Types & SemVer Impact**

While only `feat` and `fix` directly correlate with SemVer bumps, using the full set of recommended types provides comprehensive documentation.

| Type                | SemVer Implication | Description                                                                            | Example                                                   |
| :------------------ | :----------------- | :------------------------------------------------------------------------------------- | :-------------------------------------------------------- |
| **feat**            | **MINOR**          | A new feature or capability.                                                           | `feat(api): add support for pagination`                   |
| **fix**             | **PATCH**          | A bug fix.                                                                             | `fix(login): correct username validation error`           |
| **BREAKING CHANGE** | **MAJOR**          | Indicates an incompatible API change (via `!` or `BREAKING CHANGE:` footer).           | `feat!: remove legacy config option`                      |
| **docs**            | None               | Changes to documentation files (e.g., README, inline comments).                        | `docs: update installation instructions`                  |
| **style**           | None               | Changes that do not affect code logic (whitespace, formatting).                        | `style: reformat code with prettier`                      |
| **refactor**        | None               | A code change that neither fixes a bug nor adds a feature (restructuring).             | `refactor: extract utility functions`                     |
| **perf**            | None               | A code change that improves performance.                                               | `perf(query): optimize DB query speed`                    |
| **test**            | None               | Adding missing tests or correcting existing tests.                                     | `test(auth): add unit tests for token validation`         |
| **build**           | None               | Changes that affect the build system or external dependencies (e.g., npm, Dockerfile). | `build: update webpack configuration`                     |
| **ci**              | None               | Changes to CI configuration files and scripts.                                         | `ci: configure Jenkins pipeline`                          |
| **chore**           | None               | Other changes that don't modify source or test files (e.g., updating `.gitignore`).    | `chore: reorganize folder structure`                      |
| **revert**          | Tooling Dependent  | Reverts a previous commit.                                                             | `revert: let us never again speak of the noodle incident` |

---

### **Breaking Change Rules (Major Bump)**

A breaking change **MUST** be explicitly and unambiguously noted in a Conventional Commit to justify a **MAJOR** SemVer version bump.

You have two primary ways to signal a breaking change:

1.  **Via the Prefix Indicator (`!`)**

    - The `!` **MUST** be placed immediately before the colon (`:`) in the header.
    - _Example:_ `feat(api)!: remove user registration endpoint`

2.  **Via the Footer**

    - The footer **MUST** contain the uppercase text `BREAKING CHANGE:`, followed by a detailed description of the breaking change.
    - _Example:_

        ```
        feat: upgrade Node version

        BREAKING CHANGE: use JavaScript features not available in Node 6.
        ```

> **Note:** If the `!` is used in the prefix, the `BREAKING CHANGE:` footer **MAY** be omitted, but the commit body **SHALL** be used to describe the nature and migration path of the breaking change.
