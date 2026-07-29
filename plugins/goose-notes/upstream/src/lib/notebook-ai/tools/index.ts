import { listNotebooks, listPages, searchNotes, readPage } from "./notes";
import {
  appendToPage,
  createPage,
  deletePages,
  renamePage,
  replaceInPage,
  updatePage,
} from "./write";
import { showTable, showChart, showDiagram, showSvg } from "./visual";
import { loadSkill } from "./skills";
import { readWebPage, searchWeb } from "./web";
import { executeBatchPlan } from "../batch-plan";

export const notebookAiTools = {
  loadSkill,
  searchWeb,
  readWebPage,
  listNotebooks,
  listPages,
  searchNotes,
  readPage,
  createPage,
  updatePage,
  replaceInPage,
  appendToPage,
  renamePage,
  deletePages,
  executeBatchPlan,
  showTable,
  showChart,
  showDiagram,
  showSvg,
} as const;

export type NotebookAiTools = typeof notebookAiTools;

export { loadSkill };
export { searchWeb, readWebPage };
export { listNotebooks, listPages, searchNotes, readPage };
export {
  appendToPage,
  createPage,
  deletePages,
  executeBatchPlan,
  renamePage,
  replaceInPage,
  updatePage,
};
export { showTable, showChart, showDiagram, showSvg };
