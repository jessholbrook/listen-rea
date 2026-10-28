export { operationsReportConfig } from "./operations-report-config";
export type { OperationsReportConfig } from "./operations-report-config";
export type OperationsReportPreview = {
  signature: string;
  generatedAt: string;
  metadata: string[][];
  headers: string[];
  rows: (string | number)[][];
};
export function operationsReportFile(
  report: OperationsReportPreview,
  format: "csv" | "txt",
) {
  const rows = [
    ...report.metadata,
    ["UTC", report.generatedAt],
    [],
    report.headers,
    ...report.rows,
  ];
  if (format === "txt")
    return (
      rows
        .map((r) =>
          r.map((v) => String(v).replace(/[\r\n\t]/g, " ")).join("\t"),
        )
        .join("\n") + "\n"
    );
  const width = Math.max(...rows.map((r) => r.length));
  return (
    "\ufeff" +
    rows
      .map((r) =>
        Array.from({ length: width }, (_, i) => {
          let v = String(r[i] ?? "");
          if (/^[\u0000-\u0020]*[=+\-@]|^[\t\r\n]/.test(v)) v = "'" + v;
          return '"' + v.replace(/"/g, '""') + '"';
        }).join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}
export const operationsReportLabels = {
  en: {
    title: "Operations report",
    timeZone: "Report time zone",
    actor: "Changed by",
    collectionId: "Collection ID",
    taskId: "Task ID",
    notice:
      "Generate a report from these filters, review its scope, then download CSV or text. Includes all matching rows, up to 1,000; narrow the filters for larger reports. Activity includes retained events only. Downloads are copies and cannot be recalled when research is later erased.",
    generate: "Generate report preview",
    close: "Close report preview",
    reviewed: "I reviewed the report scope and preview",
    csv: "Download report CSV",
    txt: "Download report text",
    rows: "Report rows",
    preview:
      "Showing the first 10 rows; the download includes all matching rows. Scroll horizontally for more columns.",
    kind: "Report",
    asOf: "As of date",
    zone: "Time zone",
    scope: "Filters",
    all: "All",
    member: "Assignee",
    version: "Task version",
    changed: "Title changed",
    yes: "Yes",
    no: "No",
    retention: "Retained events only; older events omitted",
    failed: "Report unavailable. Generate a new preview before downloading.",
  },
  es: {
    title: "Informe de operaciones",
    timeZone: "Zona horaria del informe",
    actor: "Modificado por",
    collectionId: "ID de colección",
    taskId: "ID de tarea",
    notice:
      "Genera un informe con estos filtros, revisa su alcance y descarga CSV o texto. Incluye todas las filas coincidentes, hasta 1.000; reduce los filtros para informes mayores. La actividad incluye solo eventos conservados. Las descargas son copias y no se pueden retirar al eliminar la investigación.",
    generate: "Generar vista previa del informe",
    close: "Cerrar vista previa del informe",
    reviewed: "He revisado el alcance y la vista previa",
    csv: "Descargar informe CSV",
    txt: "Descargar informe de texto",
    rows: "Filas del informe",
    preview:
      "Se muestran las primeras 10 filas; la descarga incluye todas las filas coincidentes. Desplázate horizontalmente para ver más columnas.",
    kind: "Informe",
    asOf: "Fecha de referencia",
    zone: "Zona horaria",
    scope: "Filtros",
    all: "Todos",
    member: "Responsable",
    version: "Versión de la tarea",
    changed: "Título modificado",
    yes: "Sí",
    no: "No",
    retention: "Solo eventos conservados; eventos anteriores omitidos",
    failed:
      "Informe no disponible. Genera otra vista previa antes de descargar.",
  },
  fr: {
    title: "Rapport des opérations",
    timeZone: "Fuseau horaire du rapport",
    actor: "Modifié par",
    collectionId: "ID de collection",
    taskId: "ID de tâche",
    notice:
      "Générez un rapport avec ces filtres, vérifiez son périmètre, puis téléchargez le CSV ou le texte. Toutes les lignes correspondantes sont incluses, jusqu’à 1 000 ; réduisez les filtres au-delà. L’activité contient uniquement les événements conservés. Les téléchargements sont des copies qui ne peuvent pas être rappelées après effacement des recherches.",
    generate: "Générer un aperçu du rapport",
    close: "Fermer l’aperçu du rapport",
    reviewed: "J’ai vérifié le périmètre et l’aperçu",
    csv: "Télécharger le rapport CSV",
    txt: "Télécharger le rapport texte",
    rows: "Lignes du rapport",
    preview:
      "Les 10 premières lignes sont affichées ; le téléchargement inclut toutes les lignes correspondantes. Faites défiler horizontalement pour voir les autres colonnes.",
    kind: "Rapport",
    asOf: "Date de référence",
    zone: "Fuseau horaire",
    scope: "Filtres",
    all: "Tous",
    member: "Responsable",
    version: "Version de la tâche",
    changed: "Titre modifié",
    yes: "Oui",
    no: "Non",
    retention: "Événements conservés uniquement ; événements antérieurs omis",
    failed:
      "Rapport indisponible. Générez un nouvel aperçu avant de télécharger.",
  },
};
