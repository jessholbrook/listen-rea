import { pptxEvidenceText, pptxEvidenceLabels } from "./pptx-evidence";
import {
  docxObservationLabels,
  docxObservationsText,
} from "./docx-observations";
import {
  pptxObservationLabels,
  pptxObservationsText,
} from "./pptx-observations";
import { docxAnswersText, docxAnswerLabels } from "./docx-answers";
import { pptxAnswersText, pptxAnswerLabels } from "./pptx-answers";
import { docxSynthesisText, docxSynthesisLabels } from "./docx-synthesis";
import { pptxSynthesisText, pptxSynthesisLabels } from "./pptx-synthesis";
import { docxEvidenceText, docxEvidenceLabels } from "./docx-evidence";
import { pdfAnswersText, pdfAnswerLabels } from "./pdf-answers";
import {
  docxObservationAnswerLabels,
  docxObservationAnswersText,
} from "./docx-observation-answers";
import {
  pptxObservationAnswerLabels,
  pptxObservationAnswersText,
} from "./pptx-observation-answers";
import {
  pdfObservationAnswerLabels,
  pdfObservationAnswersText,
} from "./pdf-observation-answers";
import {
  docxObservationSynthesisLabels,
  docxObservationSynthesisText,
} from "./docx-observation-synthesis";
import {
  pptxObservationSynthesisLabels,
  pptxObservationSynthesisText,
} from "./pptx-observation-synthesis";
import {
  pdfObservationSynthesisLabels,
  pdfObservationSynthesisText,
} from "./pdf-observation-synthesis";
import { pdfObservationLabels, pdfObservationsText } from "./pdf-observations";
import { pdfSynthesisText, pdfSynthesisLabels } from "./pdf-synthesis";
import { pdfEvidenceLabels, pdfEvidenceText } from "./pdf-evidence";
import {
  attachmentSynthesisText,
  synthesisLabels,
} from "./attachment-synthesis";
import {
  attachmentEvidenceText,
  attachmentLabels,
} from "./attachment-evidence";
import { languageNames, reportingCopy } from "./localization";
import pptxgen from "pptxgenjs";
import { editionText, type ReportEdition } from "./reporting";
function chunks(text: string, size = 950) {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let end = rest.lastIndexOf(" ", size);
    if (end < size / 2) end = size;
    out.push(rest.slice(0, end));
    rest = rest.slice(end).replace(/^ /, "");
  }
  if (rest) out.push(rest);
  return out.length ? out : [""];
}
export async function presentation(e: ReportEdition) {
  const language = e.language || "en",
    labels = reportingCopy[language];
  const words: Record<string, { es: string; fr: string }> = {
    "included participants": {
      es: "participantes incluidos",
      fr: "participants inclus",
    },
    Edition: { es: "Edición", fr: "Édition" },
    "Response set": {
      es: "Conjunto de respuestas",
      fr: "Ensemble de réponses",
    },
    Concept: { es: "Concepto", fr: "Concept" },
    Revision: { es: "Revisión", fr: "Révision" },
    "Shared-question evidence": {
      es: "Evidencia de preguntas comunes",
      fr: "Données des questions communes",
    },
    Participant: { es: "Participante", fr: "Participant" },
    Turn: { es: "Intervención", fr: "Tour" },
    "Provenance & review": {
      es: "Procedencia y revisión",
      fr: "Provenance et vérification",
    },
    Study: { es: "Estudio", fr: "Étude" },
    "Source analysis": { es: "Análisis original", fr: "Analyse source" },
    Created: { es: "Creado", fr: "Créé" },
    Reviewed: { es: "Revisado", fr: "Vérifié" },
    Yes: { es: "Sí", fr: "Oui" },
    No: { es: "No", fr: "Non" },
    "Researcher-written narrative requires interpretation review. Citation validity alone does not establish research quality.":
      {
        es: "La interpretación del equipo requiere revisión. La validez de las citas no demuestra la calidad de la investigación.",
        fr: "L’interprétation de l’équipe doit être vérifiée. La validité des citations ne garantit pas la qualité de la recherche.",
      },
  };
  const w = (text: string) =>
    language === "en" ? text : words[text]?.[language] || text;
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = e.style.brand;
  pptx.subject = "Source-linked research report · " + languageNames[language];
  pptx.title = e.title;
  pptx.company = e.style.brand;
  const accent = e.style.accent.slice(1),
    font = e.style.font;
  function page(title: string) {
    const slide = pptx.addSlide();
    slide.background = { color: "FEFEFA" };
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 13.333,
      h: 0.12,
      fill: { color: accent },
      line: { color: accent },
    });
    slide.addText(title, {
      x: 0.55,
      y: 0.35,
      w: 12.2,
      h: 1,
      fontFace: font,
      fontSize: 26,
      color: accent,
      margin: 0,
      breakLine: false,
      fit: "shrink",
    });
    slide.addText(e.style.brand, {
      x: 0.55,
      y: 6.82,
      w: 3,
      h: 0.25,
      fontFace: font,
      fontSize: 10,
      color: accent,
      margin: 0,
    });
    slide.addText(e.style.footer, {
      x: 3.6,
      y: 6.78,
      w: 8.2,
      h: 0.35,
      fontFace: font,
      fontSize: 9,
      color: "666666",
      align: "right",
      margin: 0,
      fit: "shrink",
    });
    slide.addNotes(
      `Edition ${e.id} v${e.version}; response set ${e.dataVersion}; source analysis ${e.sourceAnalysisId} v${e.sourceAnalysisVersion}.`,
    );
    return slide;
  }
  const cover = page(e.title);
  cover.addText(
    `${e.sampleSize} ${w("included participants")}\n${w("Edition")} v${e.version} · ${w("Response set")} v${e.dataVersion}\n${e.scope ? `${w("Concept")}: ${e.scope.conceptId}\n${w("Revision")}: ${e.scope.revisionId}` : w("Shared-question evidence")}`,
    {
      x: 0.65,
      y: 2.2,
      w: 12,
      h: 2,
      fontFace: font,
      fontSize: 22,
      color: "333333",
      margin: 0,
    },
  );
  for (const b of e.blocks.filter((b) => !b.hidden)) {
    const pieces = chunks(b.body);
    for (let n = 0; n < pieces.length; n++) {
      const slide = page(b.title + (n ? " (" + labels.cont + ")" : ""));
      slide.addText(pieces[n], {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 20,
        color: "252D25",
        margin: 0,
        breakLine: false,
        fit: "shrink",
      });
      slide.addNotes(JSON.stringify({ blockId: b.id, citations: b.citations }));
    }
    for (const c of b.citations) {
      const quoteChunks = chunks(c.quote, 1250);
      for (let n = 0; n < quoteChunks.length; n++) {
        const slide = page(
          labels.source + " · " + b.title + (n ? " (" + labels.cont + ")" : ""),
        );
        slide.addText(quoteChunks[n], {
          x: 0.65,
          y: 1.6,
          w: 12,
          h: 3.9,
          fontFace: font,
          fontSize: 19,
          color: "252D25",
          margin: 0,
          fit: "shrink",
        });
        slide.addText(
          `${w("Participant")}: ${c.interviewId}\n${w("Turn")}: ${c.turnId}`,
          {
            x: 0.65,
            y: 5.65,
            w: 12,
            h: 0.6,
            fontFace: "Arial",
            fontSize: 10,
            color: "555555",
            margin: 0,
          },
        );
      }
    }
  }
  if (e.attachmentSynthesis?.reviewed)
    for (const piece of chunks(
      attachmentSynthesisText(e.attachmentSynthesis, language),
      950,
    )) {
      const slide = page(synthesisLabels[language].title);
      slide.addText(piece, {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 18,
        color: "252D25",
        margin: 0,
        fit: "shrink",
      });
      slide.addNotes(
        JSON.stringify({
          kind: "reviewed-observation-synthesis",
          synthesis: e.attachmentSynthesis,
        }),
      );
    }
  if (e.pdfSynthesis?.reviewed)
    for (const piece of chunks(
      pdfSynthesisText(e.pdfSynthesis, language),
      950,
    )) {
      const slide = page(pdfSynthesisLabels[language].title);
      slide.addText(piece, {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 18,
        color: "252D25",
        margin: 0,
        fit: "shrink",
      });
      slide.addNotes(
        JSON.stringify({
          kind: "reviewed-pdf-synthesis",
          synthesis: e.pdfSynthesis,
        }),
      );
    }
  if (e.docxSynthesis?.reviewed)
    for (const piece of chunks(
      docxSynthesisText(e.docxSynthesis, language),
      950,
    )) {
      const slide = page(docxSynthesisLabels[language].title);
      slide.addText(piece, {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 18,
        color: "252D25",
        margin: 0,
        fit: "shrink",
      });
      slide.addNotes(
        JSON.stringify({
          kind: "reviewed-docx-synthesis",
          synthesis: e.docxSynthesis,
        }),
      );
    }
  if (e.pptxSynthesis?.reviewed)
    for (const piece of chunks(
      pptxSynthesisText(e.pptxSynthesis, language),
      950,
    )) {
      const slide = page(pptxSynthesisLabels[language].title);
      slide.addText(piece, {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 18,
        color: "252D25",
        margin: 0,
        fit: "shrink",
      });
      slide.addNotes(
        JSON.stringify({
          kind: "reviewed-pptx-synthesis",
          synthesis: e.pptxSynthesis,
        }),
      );
    }
  for (const evi of e.attachmentEvidence || []) {
    const text = attachmentEvidenceText([evi], language);
    for (const piece of chunks(text, 950)) {
      const slide = page(attachmentLabels[language].title);
      slide.addText(piece, {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 18,
        color: "252D25",
        margin: 0,
        fit: "shrink",
      });
      slide.addNotes(
        JSON.stringify({ kind: "researcher-attachment-observation", ...evi }),
      );
    }
  }
  for (const evidence of e.pdfEvidence || []) {
    for (const piece of chunks(pdfEvidenceText([evidence], language), 950)) {
      const slide = page(pdfEvidenceLabels[language].title);
      slide.addText(piece, {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 18,
        color: "252D25",
        margin: 0,
        fit: "shrink",
      });
      slide.addNotes(
        JSON.stringify({ kind: "verified-pdf-passages", ...evidence }),
      );
    }
  }
  for (const evidence of e.pptxEvidence || []) {
    for (const piece of chunks(pptxEvidenceText([evidence], language), 950)) {
      const slide = page(pptxEvidenceLabels[language].title);
      slide.addText(piece, {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 18,
        color: "252D25",
        margin: 0,
        fit: "shrink",
      });
      slide.addNotes(
        JSON.stringify({ kind: "verified-pptx-passages", ...evidence }),
      );
    }
  }
  for (const evidence of e.docxEvidence || []) {
    for (const piece of chunks(docxEvidenceText([evidence], language), 950)) {
      const slide = page(docxEvidenceLabels[language].title);
      slide.addText(piece, {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 18,
        color: "252D25",
        margin: 0,
        fit: "shrink",
      });
      slide.addNotes(
        JSON.stringify({ kind: "verified-docx-passages", ...evidence }),
      );
    }
  }
  for (const observation of e.docxObservations || []) {
    for (const piece of chunks(
      docxObservationsText([observation], language),
      950,
    )) {
      const slide = page(docxObservationLabels[language].title);
      slide.addText(piece, {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 18,
        color: "252D25",
        margin: 0,
        fit: "shrink",
      });
      slide.addNotes(
        JSON.stringify({ kind: "researcher-docx-observation", ...observation }),
      );
    }
  }
  for (const observation of e.pptxObservations || []) {
    for (const piece of chunks(
      pptxObservationsText([observation], language),
      950,
    )) {
      const slide = page(pptxObservationLabels[language].title);
      slide.addText(piece, {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 18,
        color: "252D25",
        margin: 0,
        fit: "shrink",
      });
      slide.addNotes(
        JSON.stringify({ kind: "researcher-pptx-observation", ...observation }),
      );
    }
  }
  for (const observation of e.pdfObservations || []) {
    for (const piece of chunks(
      pdfObservationsText([observation], language),
      950,
    )) {
      const slide = page(pdfObservationLabels[language].title);
      slide.addText(piece, {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 18,
        color: "252D25",
        margin: 0,
        fit: "shrink",
      });
      slide.addNotes(
        JSON.stringify({ kind: "researcher-pdf-observation", ...observation }),
      );
    }
  }
  if (e.docxObservationSynthesis?.reviewed) {
    for (const piece of chunks(
      docxObservationSynthesisText(e.docxObservationSynthesis, language),
      950,
    )) {
      const slide = page(docxObservationSynthesisLabels[language].title);
      slide.addText(piece, {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 18,
        color: "252D25",
        margin: 0,
        fit: "shrink",
      });
      slide.addNotes(
        JSON.stringify({
          kind: "researcher-docx-observation-synthesis",
          ...e.docxObservationSynthesis,
        }),
      );
    }
  }
  if (e.pptxObservationSynthesis?.reviewed) {
    for (const piece of chunks(
      pptxObservationSynthesisText(e.pptxObservationSynthesis, language),
      950,
    )) {
      const slide = page(pptxObservationSynthesisLabels[language].title);
      slide.addText(piece, {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 18,
        color: "252D25",
        margin: 0,
        fit: "shrink",
      });
      slide.addNotes(
        JSON.stringify({
          kind: "researcher-pptx-observation-synthesis",
          ...e.pptxObservationSynthesis,
        }),
      );
    }
  }
  if (e.pdfObservationSynthesis?.reviewed) {
    for (const piece of chunks(
      pdfObservationSynthesisText(e.pdfObservationSynthesis, language),
      950,
    )) {
      const slide = page(pdfObservationSynthesisLabels[language].title);
      slide.addText(piece, {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 18,
        color: "252D25",
        margin: 0,
        fit: "shrink",
      });
      slide.addNotes(
        JSON.stringify({
          kind: "researcher-pdf-observation-synthesis",
          ...e.pdfObservationSynthesis,
        }),
      );
    }
  }
  for (const answer of e.docxAnswers || []) {
    for (const piece of chunks(docxAnswersText([answer], language), 950)) {
      const slide = page(docxAnswerLabels[language].title);
      slide.addText(piece, {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 18,
        color: "252D25",
        margin: 0,
        fit: "shrink",
      });
      slide.addNotes(JSON.stringify({ kind: "reviewed-docx-qa", ...answer }));
    }
  }
  for (const answer of e.pptxAnswers || []) {
    for (const piece of chunks(pptxAnswersText([answer], language), 950)) {
      const slide = page(pptxAnswerLabels[language].title);
      slide.addText(piece, {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 18,
        color: "252D25",
        margin: 0,
        fit: "shrink",
      });
      slide.addNotes(JSON.stringify({ kind: "reviewed-pptx-qa", ...answer }));
    }
  }
  for (const answer of e.pdfAnswers || []) {
    for (const piece of chunks(pdfAnswersText([answer], language), 950)) {
      const slide = page(pdfAnswerLabels[language].title);
      slide.addText(piece, {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 18,
        color: "252D25",
        margin: 0,
        fit: "shrink",
      });
      slide.addNotes(JSON.stringify({ kind: "reviewed-pdf-qa", ...answer }));
    }
  }
  for (const answer of e.docxObservationAnswers || []) {
    for (const piece of chunks(
      docxObservationAnswersText([answer], language),
      950,
    )) {
      const slide = page(docxObservationAnswerLabels[language].title);
      slide.addText(piece, {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 18,
        color: "252D25",
        margin: 0,
        fit: "shrink",
      });
      slide.addNotes(
        JSON.stringify({ kind: "reviewed-docx-observation-qa", ...answer }),
      );
    }
  }
  for (const answer of e.pptxObservationAnswers || []) {
    for (const piece of chunks(
      pptxObservationAnswersText([answer], language),
      950,
    )) {
      const slide = page(pptxObservationAnswerLabels[language].title);
      slide.addText(piece, {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 18,
        color: "252D25",
        margin: 0,
        fit: "shrink",
      });
      slide.addNotes(
        JSON.stringify({ kind: "reviewed-pptx-observation-qa", ...answer }),
      );
    }
  }
  for (const answer of e.pdfObservationAnswers || []) {
    for (const piece of chunks(
      pdfObservationAnswersText([answer], language),
      950,
    )) {
      const slide = page(pdfObservationAnswerLabels[language].title);
      slide.addText(piece, {
        x: 0.65,
        y: 1.6,
        w: 12,
        h: 4.75,
        fontFace: font,
        fontSize: 18,
        color: "252D25",
        margin: 0,
        fit: "shrink",
      });
      slide.addNotes(
        JSON.stringify({ kind: "reviewed-pdf-observation-qa", ...answer }),
      );
    }
  }
  pptx.addSection({ title: labels.provenance });
  const provenance = page(w("Provenance & review"));
  provenance.addText(
    `${w("Study")}: ${e.studyId}\n${w("Edition")}: ${e.id} · v${e.version}\n${w("Source analysis")}: ${e.sourceAnalysisId} · v${e.sourceAnalysisVersion}\n${w("Response set")}: ${e.dataVersion}\n${w("Created")}: ${e.createdAt}\n${w("Reviewed")}: ${w(e.reviewed ? "Yes" : "No")}\n${w("Researcher-written narrative requires interpretation review. Citation validity alone does not establish research quality.")}`,
    {
      x: 0.65,
      y: 1.6,
      w: 12,
      h: 4.75,
      fontFace: font,
      fontSize: 17,
      color: "333333",
      margin: 0,
      fit: "shrink",
    },
  );
  provenance.addNotes(editionText(e));
  return Buffer.from(
    (await pptx.write({ outputType: "nodebuffer" })) as ArrayBuffer,
  );
}
