import { templateGuide, type Guide } from "../src/lib/domain";
export function participantImageGuide(): Guide {
  const g = templateGuide("Participant image feedback");
  g.questions = [
    {
      id: "photo",
      type: "open",
      text: "Describe the experience. You may attach an image if useful.",
      section: "Experience",
      options: [],
      followUps: 0,
      instructions: "",
      condition: null,
      participantImages: true,
    },
    {
      id: "closing",
      type: "open",
      text: "What else should the team know?",
      section: "Closing",
      options: [],
      followUps: 0,
      instructions: "",
      condition: null,
    },
  ];
  return g;
}
