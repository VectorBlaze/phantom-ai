# Project Architecture Skill

## Purpose
Understand and modify projects without unnecessarily damaging their existing structure.

## Workflow
1. Inspect the directory structure.
2. Identify the application entry point.
3. Identify configuration files.
4. Identify important modules and utilities.
5. Determine how data flows through the application.
6. Modify the existing architecture when practical.
7. Only introduce new files when they have a clear purpose.

## Rules
- Respect the existing project structure.
- Do not invent nonexistent files or APIs.
- Check imports after moving or creating modules.
- Keep responsibilities separated.
- Avoid circular dependencies.
- Keep configuration separate from implementation.
- Do not duplicate utilities that already exist.