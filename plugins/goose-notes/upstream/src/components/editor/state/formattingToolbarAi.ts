import { create } from "zustand";

interface FormattingToolbarAiState {
  active: boolean;
  setActive: (active: boolean) => void;
}

export const useFormattingToolbarAi = create<FormattingToolbarAiState>((set) => ({
  active: false,
  setActive: (active) => set({ active }),
}));
