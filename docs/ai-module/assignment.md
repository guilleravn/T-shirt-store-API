# AI Module - Assignment

> **Read this entire document before getting started.**

**Duration:** 2 working days, after the AI-module courses.

Build or meaningfully improve at least **2 Claude Code Agent Skills**, then use both to deliver **one improvement to your existing Nerdery project**.

Your skills should make a developer workflow more useful or repeatable—for example, investigating bugs, running tests, reviewing changes, or updating documentation.

## Learn About Claude Code

Apply what you learned in the courses. Use these references as needed:

- [Agent Skills](https://code.claude.com/docs/en/skills)
- [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- [Writing for Agents](https://www.aihero.dev/skills-writing-for-agents)
- [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

## Explore Your Application

Use your existing frontend, backend, or full-stack repository. We will suggest an improvement based on a review of your project. Use that suggestion, or agree on a similar-sized alternative with your mentor.

**The improvement is what you change in the project. The skills are the reusable workflows you build and use to help make that change.** For example, fix a delete dialog that closes before deletion succeeds, using an investigation skill and a test-running skill.

Before starting:

1. Create a branch and record the starting commit.
2. Run the application and its existing tests, lint, and build checks. Note any failures.
3. Write down the improvement and how you will know it works. Reproduce a reported bug before fixing it.

Keep the change small enough for two days. A new application, AI-powered feature, or deployment is not required.

## Part I: Build Your Skills (Choose 2 or More)

Create each skill in **`.claude/skills/<skill-name>/SKILL.md`**, with a name, description, and instructions. Invoke it through `/skill-name`. Follow the skills guide for the file format and invocation options.

Build skills with different purposes. **At least one must run executable checks and report the results.** You may improve existing skills, but identify your changes and demonstrate them.

### A) Example skills

- **Investigate a task** — `/investigate-task`
  - Input: A bug report or proposed change.
  - Workflow: Find the relevant code and tests; propose an implementation and test plan.
  - Output: Relevant files, findings, and next steps.
- **Check a change** — `/verify-fix`
  - Input: A bug fix PR
  - Workflow: Replicate the bug before the fix and confirm it is resolved after applying the PR.
  - Output: Pre/post-fix comparison logs, bug reproduction status, and troubleshooting steps if the fix fails.
- **Sync documentation** — `/docs-sync`
  - Input: A changed feature or module.
  - Workflow: Compare the implementation with its documentation and update affected sections.
  - Output: Documentation changes and unresolved differences.

These are examples, not additional requirements. Document your skills in `docs/ai-module/writeup.md` as you build them.

### B) Repository guidance

Use `CLAUDE.md` for shared project instructions: how to run the app, where tests live, and important conventions. Keep it concise. Guidance supports your skills; it does not count as a separate skill.

### C) Optional supporting tools

[Subagents](https://code.claude.com/docs/en/sub-agents), hooks, and existing MCP integrations may support your workflows. For example, a test-writing agent and an implementation agent could work together. These tools are optional and do not replace the two skills.

## Part II: Put Your Skills to Work

Use both skills to complete your chosen improvement. Review the generated changes and add appropriate tests.

Show a relevant check failing before a fix or under a controlled failure, then succeeding afterward. Do not weaken the test to make it pass. Run each skill in a fresh session to check that it works without your earlier conversation.

Complete the **Project Results** section of the write-up with what changed, how each skill helped, and evidence of the outcome. Include short logs, test reports, or screenshots—not a full chat transcript.

Work on your branch with isolated test data. Keep credentials out of commits and obtain approval before changing shared data.

## Deliverables

1. **Two demonstrated skills**, including their `SKILL.md` files and supporting files.
2. **One project improvement**, with tests or executable checks.
3. **A short write-up** at `docs/ai-module/writeup.md` covering:
   - Each skill's design, inputs, outputs, and exact invocation.
   - Relevant references, reused tooling, and safety or rollback notes.
   - The manual workflow compared with the skill-assisted workflow.
   - How both skills contributed, evidence of failure and success, and remaining limitations.

Use the supplied template. Be ready to explain your changes and test results to your mentor.

## Submission Instructions

1. Push your branch and open **one pull request** containing all deliverables.
2. Request your mentor's review; do not merge before review.
3. Post the PR link in **`#internal-ase-nerdery-q2-2026`** by the announced deadline.
