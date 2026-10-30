/**
 * Preflight de release (H1.4): ¿este árbol se puede etiquetar y publicar?
 *
 * Existe porque dos releases seguidas (`v1.0.9`, `v1.1.0`) se etiquetaron y
 * subieron **sin APK**: el job `Release APK` falló y nadie lo miró porque el
 * preflight solo comprobaba el árbol y el tag. Las reglas viven aquí, puras y
 * testeables; `scripts/release-check.mjs` es el envoltorio que lee git y los
 * archivos.
 *
 * Reglas duras (una release no sale si alguna falla):
 *  1. tag `vMAJOR.MINOR.PATCH` y todavía sin crear
 *  2. árbol limpio
 *  3. `CHANGELOG.md` con sección `## [X.Y.Z]` propia y al menos una nota
 *  4. `[Unreleased]` vacía: notas sin fechar no viajan en una release
 *  5. el deploy inyecta `APP_VERSION` y `GIT_SHA` (`/version` no puede mentir)
 *  6. el workflow de APK se dispara con tags `v*`
 *  7. las migraciones del journal tienen su `.sql`
 */

/** Convierte el CHANGELOG en secciones consultables. */
export function parseChangelog(markdown) {
  const sections = new Map();
  let current = null;
  for (const line of markdown.split("\n")) {
    const heading = /^##\s+\[([^\]]+)\](?:\s*-\s*(.+))?\s*$/.exec(line);
    if (heading) {
      current = { version: heading[1].trim(), date: heading[2]?.trim() ?? null, bullets: [] };
      sections.set(current.version, current);
      continue;
    }
    if (current && /^\s*[-*]\s+\S/.test(line)) current.bullets.push(line.trim());
  }
  return sections;
}

/**
 * @param {object} input
 * @param {string} input.tag
 * @param {boolean} input.dirty
 * @param {string} input.changelog
 * @param {string} input.appJsonVersion
 * @param {string[]} input.existingTags
 * @param {"tag"|"commit"|null} input.tagType
 * @param {string} input.deployWorkflow
 * @param {string} input.apkWorkflow
 * @param {{ entries: { tag: string }[] }} input.journal
 * @param {(name: string) => boolean} input.sqlExists
 * @param {{ allowDirty?: boolean, allowExisting?: boolean }} [options]
 */
export function auditRelease(input, options = {}) {
  const {
    tag,
    dirty,
    changelog,
    appJsonVersion,
    existingTags,
    tagType,
    deployWorkflow,
    apkWorkflow,
  } = input;
  const problems = [];
  const notes = [];

  const version = tag?.replace(/^v/, "");

  if (!tag) {
    problems.push("falta --tag vX.Y.Z");
  } else if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag)) {
    problems.push(`tag "${tag}" no es SemVer (vMAJOR.MINOR.PATCH)`);
  } else if (existingTags.includes(tag) && !options.allowExisting) {
    problems.push(`el tag ${tag} ya existe: una release no se re-publica`);
  }

  if (dirty && !options.allowDirty) {
    problems.push("árbol sucio: commitea antes de etiquetar");
  } else if (dirty) {
    notes.push("árbol sucio ignorado por --allow-dirty (preflight)");
  }

  const sections = parseChangelog(changelog);

  if (version) {
    const section = sections.get(version);
    if (!section) {
      problems.push(
        `CHANGELOG.md no tiene sección ## [${version}]: el tag sin notas no es una release`,
      );
    } else {
      if (!section.date)
        problems.push(`## [${version}] no tiene fecha (## [${version}] - YYYY-MM-DD)`);
      if (section.bullets.length === 0) {
        problems.push(`## [${version}] no tiene ninguna nota: la release no dice qué cambió`);
      }
    }
  }

  // En CI el tag ya existe por definición, así que se audita con --allow-existing:
  // ahí las notas de [Unreleased] son de la *siguiente* release y no invalidan
  // este tag. Localmente (preflight antes de etiquetar) sí se exige vacía, que es
  // donde de verdad se decide qué notas viajan.
  const unreleased = sections.get("Unreleased");
  if (unreleased && unreleased.bullets.length > 0) {
    if (options.allowExisting) {
      notes.push(
        `[Unreleased] con ${unreleased.bullets.length} nota(s): son de la próxima release, no de ${tag}`,
      );
    } else {
      problems.push(
        `[Unreleased] tiene ${unreleased.bullets.length} nota(s): muévelas a ## [${version ?? "X.Y.Z"}] antes de etiquetar`,
      );
    }
  }

  if (!deployWorkflow.includes("APP_VERSION") || !deployWorkflow.includes("GIT_SHA")) {
    problems.push("el deploy no inyecta APP_VERSION y GIT_SHA: /version devolvería dev/unknown");
  }

  if (!/tags:\s*\[?"?v\*/.test(apkWorkflow)) {
    problems.push("el workflow de APK no se dispara con tags v*: un tag no produce binario");
  }

  const missingSql = (input.journal?.entries ?? []).filter((entry) => !input.sqlExists(entry.tag));
  if (missingSql.length) {
    problems.push(
      `migraciones del journal sin archivo SQL: ${missingSql.map((e) => e.tag).join(", ")}`,
    );
  } else if (input.journal) {
    notes.push(`migraciones registradas: ${input.journal.entries.length}`);
  }

  if (tagType && tagType !== "tag") {
    problems.push(
      `el tag ${tag} es ligero: usa un tag anotado (git tag -a) para que lleve mensaje`,
    );
  }

  if (input.tagCommit && input.headSha && input.tagCommit !== input.headSha) {
    problems.push(
      `el tag ${tag} apunta a ${input.tagCommit.slice(0, 7)} y HEAD a ${input.headSha.slice(0, 7)}: publicarías otro código`,
    );
  }

  notes.push(`app.json version: ${appJsonVersion}`);
  if (version && appJsonVersion !== version) {
    notes.push(`app.json (${appJsonVersion}) ≠ tag (${version}); EAS usa appVersionSource=remote`);
  }

  return { problems, notes };
}
