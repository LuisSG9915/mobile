/**
 * Auditoría del tablero (`docs/PLAN_MEJORAS.md`) y de `docs/decisions.md`.
 *
 * H1.3 existe porque el plan sobredeclaraba estado: filas «hechas» sin enlace,
 * `[x]` sin artefacto y pendientes escondidos dentro de una fila cerrada. Este
 * módulo convierte esas reglas en algo que falla en CI en vez de en una lectura
 * atenta del documento.
 *
 * Las reglas se aplican solo a tablas que declaran estado (`ID` + `Estado`):
 * las tablas de H2/H3 son objetivos futuros y no prometen nada.
 */

const STATUSES = new Set(["done", "in_progress", "todo", "blocked"]);

/** Marcadores de trabajo abierto dentro de una fila. */
const OPEN_WORK =
  /\b(falta|faltan|queda|quedan|pendiente|pendientes|bloquead[oa]|por hacer|sin empezar)\b/i;

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;

const FINDING_STATUS = /^(\*\*)?(Resuelto( \(unit\))?|En progreso|Abierto P1)(\*\*)?$/;

/**
 * Extrae las tablas markdown con la fila de encabezado y sus filas de datos.
 *
 * @param {string} markdown
 * @returns {{ header: string[], rows: { cells: string[], line: number }[], line: number }[]}
 */
export function parseTables(markdown) {
  const lines = markdown.split("\n");
  const tables = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const head = lines[i].trim();
    const sep = lines[i + 1].trim();
    if (!head.startsWith("|") || !/^\|[\s:|-]+\|$/.test(sep)) continue;
    const header = splitRow(head);
    const rows = [];
    let j = i + 2;
    while (j < lines.length && lines[j].trim().startsWith("|")) {
      rows.push({ cells: splitRow(lines[j]), line: j + 1 });
      j++;
    }
    tables.push({ header, rows, line: i + 1 });
    i = j - 1;
  }
  return tables;
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function column(header, name) {
  return header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
}

/** Enlaces markdown de una celda, sin anclas. */
export function linksIn(cell) {
  const found = [];
  for (const match of cell.matchAll(LINK)) found.push(match[1].split("#")[0]);
  return found;
}

function statusOf(cell) {
  return cell.replace(/[`*]/g, "").trim().toLowerCase();
}

/**
 * @param {object} input
 * @param {string} input.plan Contenido de docs/PLAN_MEJORAS.md
 * @param {string} [input.decisions] Contenido de docs/decisions.md
 * @param {(path: string) => boolean} input.fileExists Rutas relativas a docs/.
 * @returns {{ file: string, line: number, rule: string, message: string }[]}
 */
export function auditBoard({ plan, decisions = "", fileExists }) {
  const problems = [];

  /** Tablero = filas con estado propio (`done|in_progress|todo|blocked`). */
  const isBoard = (header) =>
    column(header, "ID") !== -1 &&
    column(header, "Estado") !== -1 &&
    column(header, "Resultado") !== -1;

  for (const table of parseTables(plan)) {
    if (!isBoard(table.header)) continue;
    const idCol = column(table.header, "ID");
    const statusCol = column(table.header, "Estado");
    // El tablero historiza la columna como «Evidencia de cierre».
    const evidenceCol =
      column(table.header, "Evidencia") !== -1
        ? column(table.header, "Evidencia")
        : column(table.header, "Evidencia de cierre");
    if (evidenceCol === -1) continue;
    const workCol = column(table.header, "Trabajo");

    for (const row of table.rows) {
      const id = row.cells[idCol]?.replace(/[*`]/g, "") ?? "?";
      const status = statusOf(row.cells[statusCol] ?? "");
      const evidence = (evidenceCol === -1 ? "" : row.cells[evidenceCol]) ?? "";
      const work = (workCol === -1 ? "" : row.cells[workCol]) ?? "";
      const cells = `${work} ${evidence}`;

      // R1 · vocabulario de estado
      if (!STATUSES.has(status)) {
        problems.push({
          file: "docs/PLAN_MEJORAS.md",
          line: row.line,
          rule: "estado-desconocido",
          message: `${id}: estado "${status}" fuera de done|in_progress|todo|blocked`,
        });
        continue;
      }

      // R2 · toda fila con estado tiene que apuntar a algo que se pueda abrir
      const links = linksIn(cells);
      if (links.length === 0) {
        problems.push({
          file: "docs/PLAN_MEJORAS.md",
          line: row.line,
          rule: "sin-enlace",
          message: `${id}: la fila no enlaza ni trabajo ni evidencia`,
        });
      }

      // R3 · los enlaces del tablero deben existir
      for (const link of links) {
        if (/^[a-z]+:/i.test(link) || link.startsWith("#")) continue;
        if (!fileExists(link)) {
          problems.push({
            file: "docs/PLAN_MEJORAS.md",
            line: row.line,
            rule: "enlace-roto",
            message: `${id}: enlace inexistente → ${link}`,
          });
        }
      }

      // R4 · una fila `done` no puede llevar trabajo abierto dentro
      if (status === "done" && OPEN_WORK.test(cells)) {
        problems.push({
          file: "docs/PLAN_MEJORAS.md",
          line: row.line,
          rule: "done-con-pendientes",
          message: `${id}: marcada done pero su texto declara trabajo pendiente`,
        });
      }

      // R5 · una fila en curso tiene que decir qué le falta
      if (status === "in_progress" && !OPEN_WORK.test(cells)) {
        problems.push({
          file: "docs/PLAN_MEJORAS.md",
          line: row.line,
          rule: "en-curso-sin-brecha",
          message: `${id}: in_progress sin decir qué falta para cerrar`,
        });
      }
    }
  }

  // R6 · tabla de hallazgos (§1.2): un «Resuelto» necesita test o código
  for (const table of parseTables(plan)) {
    const idCol = column(table.header, "ID");
    const statusCol = column(table.header, "Estado");
    if (idCol === -1 || statusCol === -1) continue;
    const evidenceCol = column(table.header, "Evidencia actual");
    if (evidenceCol === -1) continue;

    for (const row of table.rows) {
      const id = row.cells[idCol] ?? "?";
      const status = (row.cells[statusCol] ?? "").trim();
      const evidence = row.cells[evidenceCol] ?? "";
      if (!FINDING_STATUS.test(status)) {
        problems.push({
          file: "docs/PLAN_MEJORAS.md",
          line: row.line,
          rule: "hallazgo-estado",
          message: `${id}: estado de hallazgo "${status}" no reconocido`,
        });
        continue;
      }
      if (/Resuelto/.test(status) && linksIn(evidence).length === 0) {
        problems.push({
          file: "docs/PLAN_MEJORAS.md",
          line: row.line,
          rule: "hallazgo-sin-evidencia",
          message: `${id}: marcado resuelto sin enlace al test o al código`,
        });
      }
    }
  }

  // R7 · decisions.md no guarda trabajo abierto
  decisions.split("\n").forEach((line, index) => {
    if (/^\s*-\s*\[ \]/.test(line) || /\bPENDIENTE\b|\bTODO\b/.test(line)) {
      problems.push({
        file: "docs/decisions.md",
        line: index + 1,
        rule: "decision-abierta",
        message: `decisión con pendiente: "${line.trim().slice(0, 80)}"`,
      });
    }
  });

  return problems;
}
