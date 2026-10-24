# Researcher workflow

Deployed at https://echo-lab-psi.vercel.app on October 19, 2026. This module adds draft history, reusable audiences, study folders, workspace defaults and a rule-based study advisor. Human evaluation remains deferred while the build continues.

## Guide history and restore

Open a study’s **Workflow** tab to review draft snapshots and immutable published guides. New studies keep a creation snapshot. Saves, publication, audience additions and restores add entries with the researcher’s name, time and study version. A restore points back to its source snapshot. Existing studies retain their published guides; their next edit, publication, audience addition or restore preserves the current draft as a baseline. Earlier unsaved or overwritten drafts cannot be recovered retroactively.

Review the complete candidate, including routing and stimulus details, before selecting **Restore as new draft**. Restore replaces the saved draft’s title, objective, introduction, questions, routing and concept configuration. It creates another history entry rather than deleting later entries. It does not change the published revision, admission state, existing interview snapshots, responses, folders or results. Publish separately to use a restored guide for newly admitted participants. Version checks reject changes based on an outdated study instead of overwriting another researcher’s work.

History is persistent document data in the workspace database. It is guide history, not an immutable security audit log or a complete account of every workspace action.

## Saved audiences

In **Workflow**, name an audience and select its single-choice screening questions from the saved draft. The library stores the audience description, option labels, screen-out rules, option randomization and self-contained question/section routing. Include all earlier screeners referenced by the selected questions. Invalid or external dependencies are rejected. Open questions, mixed-method questions and repeated concept questions are not supported as reusable screeners in this module.

Choose **Review audience** to see the proposed combined guide. **Add audience to draft** replaces the audience description and prepends fresh copies of the saved screeners. Existing questions remain; remove overlapping screeners manually before publishing. Imported question IDs and section names are independent, and routing references are remapped together. Applying an audience does not alter its source or any published guide. Removing a saved audience from the library leaves existing study copies intact.

Saved audiences reuse screening design. They do not recruit participants, verify identity, enforce demographic quotas or balance concept assignment. Quota enforcement remains later work in F15.

## Folders and workspace defaults

Open **Research library** in the workspace navigation to create, rename or remove folders and manage saved audiences. Move a study using **Study folder** in its Workflow tab. Filter the dashboard by folder or Unfiled. Removing a folder keeps its studies in Unfiled; it does not delete research data.

Admins can save default audience text, participant introduction, participant limit and internal research guidelines. A new study copies these values at creation. Defaults do not update existing drafts, published guides or interviews. Guidelines are internal context for AI guide drafting in new studies; they are not sent as participant-facing introduction text or automatically applied to moderation. The starter template’s questions remain editable and should be reviewed for fit with the selected audience and objective. Guidelines do not guarantee that generated content follows them.

Collaborators and researchers can organize studies, reuse audiences and restore drafts under existing edit permissions. Collaborators still cannot publish or open fielding. Only admins can change workspace defaults. Library items and history are scoped to the signed-in workspace; participant tokens do not grant library access.

## Study advisor

The **Study advisor** beside the guide editor checks the current unsaved guide. It shows schema/routing problems separately from suggestions about leading language, compound prompts, duplicate questions, predicted behavior, all-reject screeners, lack of open questions, answer-turn burden and linked-image access. Question-specific findings link to the editor. Suggestions do not rewrite, save or publish anything.

These are transparent rules with limited pattern coverage, not AI review, a quality score, accessibility verification or proof of valid research design. No flags does not establish that a guide is suitable. Linked images and interview paths still need preview and human review.

## Verification

`npm test` exercises restore traceability, concurrent-edit rejection, active-revision/interview preservation, copied defaults, screener routing and workspace/role boundaries. `npm run test:workflow` covers the visible library, new-study defaults, folder assignment/filtering, audience review/application, snapshot restore, advisor and mobile layout. Browser suites share port 3101 and must run sequentially.

The production build, type checks, 26 automated tests and all six browser suites passed. Hosted synthetic checks confirmed copied defaults, independent screeners, traceable restores, stale-write rejection and library removal that retains study data. Temporary production workspaces and sessions were cleaned up. These checks do not establish human research quality.
