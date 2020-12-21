import { filter } from 'lodash';

import {
  DELETE_DECK,
  UPDATE_DECK,
  RESET_DECK_CHECKLIST,
  SET_DECK_CHECKLIST_CARD,
  EditDeckState,
  START_DECK_EDIT,
  FINISH_DECK_EDIT,
  UPDATE_DECK_EDIT_COUNTS,
  UPDATE_DECK_EDIT,
  DeckEditsActions,
  REPLACE_LOCAL_DECK,
} from '@actions/types';

interface DeckEditsState {
  edits: {
    [id: number]: EditDeckState | undefined;
  }
  editting: {
    [id: number]: boolean | undefined;
  };
  checklist: {
    [id: number]: string[] | undefined;
  };
}

const DEFAULT_DECK_EDITS_STATE: DeckEditsState = {
  edits: {},
  editting: {},
  checklist: {},
};

export default function(
  state = DEFAULT_DECK_EDITS_STATE,
  action: DeckEditsActions
): DeckEditsState {
  if (action.type === START_DECK_EDIT) {
    const newEdits = action.deck ? {
      ...state.edits || {},
      [action.id]: {
        nameChange: undefined,
        meta: action.deck.meta || {},
        slots: action.deck.slots || {},
        ignoreDeckLimitSlots: action.deck.ignoreDeckLimitSlots || {},
        xpAdjustment: action.deck.xp_adjustment || 0,
      },
    } : state.edits;
    return {
      ...state,
      editting: {
        ...state.editting || {},
        [action.id]: true,
      },
      edits: newEdits,
    };
  }
  if (action.type === FINISH_DECK_EDIT) {
    const newEditting = { ...state.editting || {} };
    delete newEditting[action.id];
    const newEdits = { ...state.edits || {} };
    delete newEdits[action.id];
    return {
      ...state,
      editting: newEditting,
      edits: newEdits,
    };
  }

  if (action.type === UPDATE_DECK_EDIT) {
    const currentEdits = (state.edits || {})[action.id];
    if (!currentEdits) {
      // Shouldn't happen
      return state;
    }
    const updatedEdits = { ...currentEdits };

    if (action.updates.nameChange !== undefined) {
      updatedEdits.nameChange = action.updates.nameChange;
    }
    if (action.updates.tabooSetChange !== undefined) {
      updatedEdits.tabooSetChange = action.updates.tabooSetChange;
    }
    if (action.updates.meta !== undefined) {
      updatedEdits.meta = action.updates.meta;
    }
    if (action.updates.slots !== undefined) {
      updatedEdits.slots = action.updates.slots;
    }
    if (action.updates.ignoreDeckLimitSlots !== undefined) {
      updatedEdits.ignoreDeckLimitSlots = action.updates.ignoreDeckLimitSlots;
    }
    if (action.updates.xpAdjustment !== undefined) {
      updatedEdits.xpAdjustment = action.updates.xpAdjustment;
    }
    return {
      ...state,
      edits: {
        ...state.edits,
        [action.id]: updatedEdits,
      },
    };
  }

  if (action.type === UPDATE_DECK_EDIT_COUNTS) {
    const currentEdits = (state.edits || {})[action.id];
    if (!currentEdits) {
      // Shouldn't happen
      return state;
    }
    if (action.countType === 'xpAdjustment') {
      let xpAdjustment = currentEdits.xpAdjustment;
      switch (action.operation) {
        case 'inc': xpAdjustment++; break;
        case 'dec': xpAdjustment--; break;
        case 'set': xpAdjustment = action.value; break;
      }
      return {
        ...state,
        edits: {
          ...state.edits,
          [action.id]: {
            ...currentEdits,
            xpAdjustment,
          },
        },
      };
    }
    const currentSlots = {
      ...(action.countType === 'slots' ? currentEdits.slots : currentEdits.ignoreDeckLimitSlots),
    };
    switch (action.operation) {
      case 'set':
        currentSlots[action.code] = action.value;
        break;
      case 'dec':
        currentSlots[action.code] = Math.max((currentSlots[action.code] || 0) - 1, 0);
        break;
      case 'inc':
        currentSlots[action.code] = Math.min((currentSlots[action.code] || 0) + 1, action.limit || 2);
        break;
    }
    if (!currentSlots[action.code]) {
      delete currentSlots[action.code];
    }

    const updatedEdits = { ...currentEdits };
    if (action.countType === 'slots') {
      updatedEdits.slots = currentSlots;
    } else {
      updatedEdits.ignoreDeckLimitSlots = currentSlots;
    }

    return {
      ...state,
      edits: {
        ...state.edits,
        [action.id]: updatedEdits,
      },
    };
  }
  if (action.type === RESET_DECK_CHECKLIST) {
    return {
      ...state,
      checklist: {
        ...(state.checklist || {}),
        [`${action.id}`]: [],
      },
    };
  }
  if (action.type === SET_DECK_CHECKLIST_CARD) {
    const currentChecklist = (state.checklist || {})[action.id] || [];
    const checklist = action.value ? [
      ...currentChecklist,
      action.card,
    ] : filter(currentChecklist, card => card !== action.card);
    return {
      ...state,
      checklist: {
        ...(state.checklist || {}),
        [action.id]: checklist,
      },
    };
  }

  if (action.type === DELETE_DECK) {
    const checklist = {
      ...(state.checklist || {}),
    };
    if (checklist[action.id]) {
      delete checklist[action.id];
    }
    return {
      ...state,
      checklist,
    };
  }
  if (action.type === UPDATE_DECK) {
    if (!action.deck) {
      return state;
    }
    if ((state.editting || {})[action.id]) {
      return {
        ...state,
        edits: {
          ...(state.edits || {}),
          [action.id]: {
            nameChange: undefined,
            tabooSetChange: undefined,
            slots: action.deck.slots,
            ignoreDeckLimitSlots: action.deck.ignoreDeckLimitSlots || {},
            meta: action.deck.meta || {},
            xpAdjustment: action.deck.xp_adjustment || 0,
          },
        },
      };
    }
    return state;
  }

  if (action.type === REPLACE_LOCAL_DECK) {
    const checklist = {
      ...(state.checklist || {}),
    };
    if (checklist[action.localId]) {
      checklist[action.deck.id] = checklist[action.localId];
      delete checklist[action.localId];
    }
    return {
      ...state,
      checklist,
    };
  }
  return state;
}
