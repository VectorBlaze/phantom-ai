# Debugging Skill

## Purpose
Diagnose and fix software failures systematically.

## Workflow
1. Reproduce the failure.
2. Read the complete error message.
3. Identify the file and line responsible.
4. Trace the cause rather than only the symptom.
5. Inspect related files when necessary.
6. Apply the smallest correct fix.
7. Run the failing command again.
8. Verify that the original problem is gone.
9. Check for obvious regressions.

## Rules
- Never randomly change multiple things at once.
- Do not hide errors.
- Do not suppress exceptions just to make the application start.
- Prefer root-cause fixes.
- Use actual terminal output as evidence.
- If a dependency is broken, verify the dependency state before changing application code.