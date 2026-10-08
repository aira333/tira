// apps/skill-backend/src/dialogue/listFlow.js
// Shopping + Todo dialogue facade (domain bodies in shoppingListFlow / todoListFlow)

const Alexa = require('../ask');
const prompts = require('./prompts');
const {
  SHOPPING_STEPS,
  TODO_STEPS,
  isNextPageUtterance,
  isPrevPageUtterance,
  isStopReadUtterance,
  isDoneAddingMore,
  isReadListUtterance,
  openReprompt,
  cleanNameAnswer,
} = require('./listShared');
const {
  startShoppingAdd,
  startShoppingMark,
  startShoppingRemove,
  startShoppingClear,
  finishShoppingAdd,
  finishShoppingMark,
  finishShoppingRemove,
  finishShoppingClear,
  presentShoppingPage,
  presentGetShopping,
} = require('./shoppingListFlow');
const {
  startTodoAdd,
  startTodoMark,
  startTodoRemove,
  startTodoClear,
  finishTodoAdd,
  finishTodoMark,
  finishTodoRemove,
  finishTodoClear,
  presentTodoPage,
  presentGetTodo,
} = require('./todoListFlow');

async function speakCurrentList(userId, dialogue) {
  if (dialogue.domain === 'shopping' && dialogue.slots.storeName) {
    return presentGetShopping(userId, dialogue.slots.storeName);
  }
  if (dialogue.domain === 'todo') {
    const listName = dialogue.slots.listName || 'to do';
    return presentGetTodo(userId, listName);
  }
  return null;
}

function promptForListStep(dialogue) {
  const { domain, step, slots } = dialogue;
  if (domain === 'shopping') {
    switch (step) {
      case SHOPPING_STEPS.STORE:
        return {
          speak: "Which store is this shopping list for? For example, Target or Costco.",
          reprompt: 'Please tell me the name of the store.',
        };
      case SHOPPING_STEPS.ITEMS:
        return {
          speak: `What items would you like to add to your ${slots.storeName} list? Say add, then the items. For example, add milk and eggs.`,
          reprompt: 'Say add, then the items. For example, add milk and eggs.',
        };
      case SHOPPING_STEPS.MORE:
        return {
          speak: `Anything else for your ${slots.storeName} list? Say add, then another item, or say no.`,
          reprompt: `Say add, then an item for ${slots.storeName}, or say no.`,
        };
      case SHOPPING_STEPS.MARK_STORE:
        return {
          speak: "Which store's list does that item belong to?",
          reprompt: 'Which store?',
        };
      case SHOPPING_STEPS.MARK_ITEM:
        return {
          speak: `Which item on your ${slots.storeName} list would you like to mark as done?`,
          reprompt: 'Which item?',
        };
      case SHOPPING_STEPS.REMOVE_STORE:
        return {
          speak: "Which store's list should I remove that from?",
          reprompt: 'Which store?',
        };
      case SHOPPING_STEPS.REMOVE_ITEM:
        return {
          speak: `Which item should I remove from your ${slots.storeName} list?`,
          reprompt: 'Which item should I remove?',
        };
      case SHOPPING_STEPS.CLEAR_STORE:
        return {
          speak: 'Which store list should I clear completed items from?',
          reprompt: 'Which store?',
        };
      case SHOPPING_STEPS.READ_PAGE:
        return {
          speak: 'Say next for more items, previous to go back, or stop when you are done.',
          reprompt: 'Say next, previous, or stop.',
        };
      default:
        return prompts.unclearIdle();
    }
  }

  if (domain === 'todo') {
    switch (step) {
      case TODO_STEPS.LIST:
        return {
          speak: 'Which to do list is this for? For example, work or home.',
          reprompt: 'Please tell me the name of the list.',
        };
      case TODO_STEPS.ITEMS:
        return {
          speak: `What would you like to add to your ${slots.listName} list? Say add, then the items. For example, add call the pharmacy.`,
          reprompt: 'Say add, then the items. For example, add call the pharmacy.',
        };
      case TODO_STEPS.MORE: {
        const label =
          String(slots.listName || '').toLowerCase() === 'to do'
            ? 'to do list'
            : `${slots.listName} to do list`;
        return {
          speak: `Anything else for your ${label}? Say add, then another task, or say no.`,
          reprompt: `Say add, then a task for your ${label}, or say no.`,
        };
      }
      case TODO_STEPS.MARK_LIST:
        return {
          speak: 'Which to do list does that belong to?',
          reprompt: 'Which list?',
        };
      case TODO_STEPS.MARK_ITEM:
        return {
          speak: `Which item on your ${slots.listName} list would you like to mark as done?`,
          reprompt: 'Which item?',
        };
      case TODO_STEPS.REMOVE_LIST:
        return {
          speak: 'Which to do list should I remove that from?',
          reprompt: 'Which list?',
        };
      case TODO_STEPS.REMOVE_ITEM:
        return {
          speak: `Which item should I remove from your ${slots.listName} list?`,
          reprompt: 'Which item should I remove?',
        };
      case TODO_STEPS.CLEAR_LIST:
        return {
          speak: 'Which to do list should I clear completed items from?',
          reprompt: 'Which list?',
        };
      case TODO_STEPS.READ_PAGE:
        return {
          speak: 'Say next for more items, previous to go back, or stop when you are done.',
          reprompt: 'Say next, previous, or stop.',
        };
      default:
        return prompts.unclearIdle();
    }
  }

  return prompts.unclearIdle();
}

/**
 * Strip a re-said "add X to my {store/list} list" command wrapper from a
 * mid-flow item answer. The FreeForm slot (and the raw utterance fallback)
 * carry the whole sentence verbatim — without this, saying the full add
 * command again while the list is already open bakes "add" and "to my ...
 * list" into the saved item text instead of just the item names.
 */
function stripAddCommandWrapper(text) {
  return String(text || '')
    .replace(/^(?:add|also|put)\s+/i, '')
    .replace(/\s+to\s+(?:my|the)\s+.+\blist\b\s*$/i, '')
    .trim();
}

/**
 * Prefer the raw Alexa StoreName/ListName slot over the reconstructed
 * utterance on store/list-name-elicit steps. A bare "Target" answer with no
 * Items slot filled gets reconstructed by buildSpokenText as "shopping list
 * for Target" (or "create a {list} to do list") for classification purposes
 * elsewhere — that wrapper text must not leak into the saved name itself.
 */
function nameSpokenAnswer(handlerInput, utterance, slotName) {
  const envelope = handlerInput.requestEnvelope;
  const value = Alexa.getSlotValue(envelope, slotName);
  if (value && String(value).trim()) return cleanNameAnswer(value);
  return cleanNameAnswer(stripAddCommandWrapper(utterance));
}

/**
 * Prefer Alexa Items / FreeForm slots on item-elicit steps so reconstructed
 * "add X to my shopping list" carriers do not pollute parseItemsList.
 */
function itemSpokenAnswer(handlerInput, utterance) {
  const envelope = handlerInput.requestEnvelope;
  const items = Alexa.getSlotValue(envelope, 'Items');
  if (items && String(items).trim()) return cleanNameAnswer(items);
  // Bare nouns often hit mark/remove intents mid-flow (ItemName filled, Items empty).
  const itemName = Alexa.getSlotValue(envelope, 'ItemName');
  if (itemName && String(itemName).trim()) return cleanNameAnswer(itemName);
  const freeForm = Alexa.getSlotValue(envelope, 'FreeForm');
  if (freeForm && String(freeForm).trim()) {
    return cleanNameAnswer(stripAddCommandWrapper(freeForm));
  }
  return cleanNameAnswer(stripAddCommandWrapper(utterance));
}

async function applyListAnswer(handlerInput, utterance) {
  const session = handlerInput.attributesManager.getSessionAttributes();
  const { getDialogue } = require('./state');
  const current = getDialogue(session);
  const dialogue = {
    domain: current.domain,
    step: current.step,
    slots: { ...current.slots },
    promptId: current.promptId,
  };
  if (!dialogue.step) {
    return { dialogue: null, done: true, prompt: prompts.unclearIdle() };
  }

  const userId =
    handlerInput.requestEnvelope.context?.System?.user?.userId ||
    handlerInput.requestEnvelope.session?.user?.userId;
  const onItemStep =
    dialogue.step === SHOPPING_STEPS.ITEMS ||
    dialogue.step === SHOPPING_STEPS.MORE ||
    dialogue.step === TODO_STEPS.ITEMS ||
    dialogue.step === TODO_STEPS.MORE;
  const onStoreNameStep =
    dialogue.step === SHOPPING_STEPS.STORE ||
    dialogue.step === SHOPPING_STEPS.MARK_STORE ||
    dialogue.step === SHOPPING_STEPS.REMOVE_STORE ||
    dialogue.step === SHOPPING_STEPS.CLEAR_STORE;
  const onListNameStep =
    dialogue.step === TODO_STEPS.LIST ||
    dialogue.step === TODO_STEPS.MARK_LIST ||
    dialogue.step === TODO_STEPS.REMOVE_LIST ||
    dialogue.step === TODO_STEPS.CLEAR_LIST;
  const spoken = onItemStep
    ? itemSpokenAnswer(handlerInput, utterance)
    : onStoreNameStep
      ? nameSpokenAnswer(handlerInput, utterance, 'StoreName')
      : onListNameStep
        ? nameSpokenAnswer(handlerInput, utterance, 'ListName')
        : cleanNameAnswer(utterance);

  if (
    (dialogue.domain === 'shopping' || dialogue.domain === 'todo') &&
    isReadListUtterance(utterance)
  ) {
    const read = await speakCurrentList(userId, dialogue);
    if (read) return read;
  }

  if (dialogue.domain === 'shopping' && dialogue.slots.mode === 'add') {
    if (dialogue.step === SHOPPING_STEPS.MORE) {
      if (isDoneAddingMore(utterance)) {
        return {
          dialogue: { domain: null, step: null, slots: {} },
          done: true,
          prompt: {
            speak: 'Okay. What else can I help you with?',
            reprompt: prompts.OPEN_REPROMPT,
          },
        };
      }
      if (!spoken) {
        return { dialogue, done: false, prompt: promptForListStep(dialogue) };
      }
      dialogue.slots.items = spoken;
      return finishShoppingAdd(userId, dialogue);
    }
    if (dialogue.step === SHOPPING_STEPS.STORE) {
      if (!spoken) {
        return { dialogue, done: false, prompt: promptForListStep(dialogue) };
      }
      dialogue.slots.storeName = spoken;
      if (dialogue.slots.items) {
        return finishShoppingAdd(userId, dialogue);
      }
      dialogue.step = SHOPPING_STEPS.ITEMS;
      dialogue.promptId = dialogue.step;
      return { dialogue, done: false, prompt: promptForListStep(dialogue) };
    }
    if (dialogue.step === SHOPPING_STEPS.ITEMS) {
      if (!spoken) {
        return { dialogue, done: false, prompt: promptForListStep(dialogue) };
      }
      dialogue.slots.items = spoken;
      return finishShoppingAdd(userId, dialogue);
    }
  }

  if (dialogue.domain === 'todo' && dialogue.slots.mode === 'add') {
    if (dialogue.step === TODO_STEPS.MORE) {
      if (isDoneAddingMore(utterance)) {
        return {
          dialogue: { domain: null, step: null, slots: {} },
          done: true,
          prompt: {
            speak: 'Okay. What else can I help you with?',
            reprompt: prompts.OPEN_REPROMPT,
          },
        };
      }
      if (!spoken) {
        return { dialogue, done: false, prompt: promptForListStep(dialogue) };
      }
      dialogue.slots.items = spoken;
      return finishTodoAdd(userId, dialogue);
    }
    if (dialogue.step === TODO_STEPS.LIST) {
      if (!spoken) {
        return { dialogue, done: false, prompt: promptForListStep(dialogue) };
      }
      dialogue.slots.listName = spoken;
      if (dialogue.slots.items) {
        return finishTodoAdd(userId, dialogue);
      }
      dialogue.step = TODO_STEPS.ITEMS;
      dialogue.promptId = dialogue.step;
      return { dialogue, done: false, prompt: promptForListStep(dialogue) };
    }
    if (dialogue.step === TODO_STEPS.ITEMS) {
      if (!spoken) {
        return { dialogue, done: false, prompt: promptForListStep(dialogue) };
      }
      dialogue.slots.items = spoken;
      return finishTodoAdd(userId, dialogue);
    }
  }

  if (dialogue.domain === 'shopping' && dialogue.slots.mode === 'mark') {
    if (dialogue.step === SHOPPING_STEPS.MARK_STORE) {
      if (!spoken) {
        return { dialogue, done: false, prompt: promptForListStep(dialogue) };
      }
      dialogue.slots.storeName = spoken;
      if (dialogue.slots.itemName) {
        return finishShoppingMark(userId, dialogue);
      }
      dialogue.step = SHOPPING_STEPS.MARK_ITEM;
      dialogue.promptId = dialogue.step;
      return { dialogue, done: false, prompt: promptForListStep(dialogue) };
    }
    if (dialogue.step === SHOPPING_STEPS.MARK_ITEM) {
      if (!spoken) {
        return { dialogue, done: false, prompt: promptForListStep(dialogue) };
      }
      dialogue.slots.itemName = spoken;
      return finishShoppingMark(userId, dialogue);
    }
  }

  if (dialogue.domain === 'todo' && dialogue.slots.mode === 'mark') {
    if (dialogue.step === TODO_STEPS.MARK_LIST) {
      if (!spoken) {
        return { dialogue, done: false, prompt: promptForListStep(dialogue) };
      }
      dialogue.slots.listName = spoken;
      if (dialogue.slots.itemName) {
        return finishTodoMark(userId, dialogue);
      }
      dialogue.step = TODO_STEPS.MARK_ITEM;
      dialogue.promptId = dialogue.step;
      return { dialogue, done: false, prompt: promptForListStep(dialogue) };
    }
    if (dialogue.step === TODO_STEPS.MARK_ITEM) {
      if (!spoken) {
        return { dialogue, done: false, prompt: promptForListStep(dialogue) };
      }
      dialogue.slots.itemName = spoken;
      return finishTodoMark(userId, dialogue);
    }
  }

  if (dialogue.domain === 'shopping' && dialogue.slots.mode === 'remove') {
    if (dialogue.step === SHOPPING_STEPS.REMOVE_STORE) {
      if (!spoken) {
        return { dialogue, done: false, prompt: promptForListStep(dialogue) };
      }
      dialogue.slots.storeName = spoken;
      if (dialogue.slots.itemName) {
        return finishShoppingRemove(userId, dialogue);
      }
      dialogue.step = SHOPPING_STEPS.REMOVE_ITEM;
      dialogue.promptId = dialogue.step;
      return { dialogue, done: false, prompt: promptForListStep(dialogue) };
    }
    if (dialogue.step === SHOPPING_STEPS.REMOVE_ITEM) {
      if (!spoken) {
        return { dialogue, done: false, prompt: promptForListStep(dialogue) };
      }
      dialogue.slots.itemName = spoken;
      return finishShoppingRemove(userId, dialogue);
    }
  }

  if (dialogue.domain === 'todo' && dialogue.slots.mode === 'remove') {
    if (dialogue.step === TODO_STEPS.REMOVE_LIST) {
      if (!spoken) {
        return { dialogue, done: false, prompt: promptForListStep(dialogue) };
      }
      dialogue.slots.listName = spoken;
      if (dialogue.slots.itemName) {
        return finishTodoRemove(userId, dialogue);
      }
      dialogue.step = TODO_STEPS.REMOVE_ITEM;
      dialogue.promptId = dialogue.step;
      return { dialogue, done: false, prompt: promptForListStep(dialogue) };
    }
    if (dialogue.step === TODO_STEPS.REMOVE_ITEM) {
      if (!spoken) {
        return { dialogue, done: false, prompt: promptForListStep(dialogue) };
      }
      dialogue.slots.itemName = spoken;
      return finishTodoRemove(userId, dialogue);
    }
  }

  if (dialogue.domain === 'shopping' && dialogue.slots.mode === 'clear') {
    if (dialogue.step === SHOPPING_STEPS.CLEAR_STORE) {
      if (!spoken) {
        return { dialogue, done: false, prompt: promptForListStep(dialogue) };
      }
      dialogue.slots.storeName = spoken;
      return finishShoppingClear(userId, dialogue);
    }
  }

  if (dialogue.domain === 'todo' && dialogue.slots.mode === 'clear') {
    if (dialogue.step === TODO_STEPS.CLEAR_LIST) {
      if (!spoken) {
        return { dialogue, done: false, prompt: promptForListStep(dialogue) };
      }
      dialogue.slots.listName = spoken;
      return finishTodoClear(userId, dialogue);
    }
  }

  if (
    (dialogue.domain === 'shopping' || dialogue.domain === 'todo') &&
    dialogue.slots.mode === 'read' &&
    dialogue.step ===
      (dialogue.domain === 'shopping' ? SHOPPING_STEPS.READ_PAGE : TODO_STEPS.READ_PAGE)
  ) {
    if (isStopReadUtterance(utterance)) {
      if (dialogue.domain === 'shopping') {
        const open = openReprompt('shopping', dialogue.slots.storeName);
        return {
          dialogue: {
            domain: 'shopping',
            step: SHOPPING_STEPS.MORE,
            slots: {
              storeName: dialogue.slots.storeName,
              items: null,
              mode: 'add',
            },
            promptId: SHOPPING_STEPS.MORE,
          },
          done: false,
          prompt: {
            speak: `Okay.${open.speakExtra}`,
            reprompt: open.reprompt,
          },
        };
      }
      const open = openReprompt('todo', dialogue.slots.listName);
      return {
        dialogue: {
          domain: 'todo',
          step: TODO_STEPS.MORE,
          slots: {
            listName: dialogue.slots.listName,
            items: null,
            mode: 'add',
          },
          promptId: TODO_STEPS.MORE,
        },
        done: false,
        prompt: {
          speak: `Okay.${open.speakExtra}`,
          reprompt: open.reprompt,
        },
      };
    }
    let page = dialogue.slots.page || 0;
    if (isNextPageUtterance(utterance)) page += 1;
    else if (isPrevPageUtterance(utterance)) page = Math.max(0, page - 1);
    else {
      return { dialogue, done: false, prompt: promptForListStep(dialogue) };
    }
    dialogue.slots.page = page;
    if (dialogue.domain === 'shopping') {
      return presentShoppingPage(userId, dialogue.slots.storeName, page);
    }
    return presentTodoPage(userId, dialogue.slots.listName, page);
  }

  return { dialogue, done: false, prompt: promptForListStep(dialogue) };
}

function respondWithListResult(handlerInput, result) {
  const { setDialogue, clearDialogue } = require('./state');
  let session = handlerInput.attributesManager.getSessionAttributes();
  if (result.done) {
    session = clearDialogue(session);
  } else {
    session = clearDialogue(session);
    session = setDialogue(session, result.dialogue);
  }
  handlerInput.attributesManager.setSessionAttributes(session);
  return handlerInput.responseBuilder
    .speak(result.prompt.speak)
    .reprompt(result.prompt.reprompt || result.prompt.speak)
    .getResponse();
}

async function prepareAndMaybeFinish(handlerInput, dialogue) {
  const userId =
    handlerInput.requestEnvelope.context?.System?.user?.userId ||
    handlerInput.requestEnvelope.session?.user?.userId;

  if (dialogue.step === 'ready_to_save') {
    if (dialogue.domain === 'shopping') return finishShoppingAdd(userId, dialogue);
    if (dialogue.domain === 'todo') return finishTodoAdd(userId, dialogue);
  }
  if (dialogue.step === 'ready_to_mark') {
    if (dialogue.domain === 'shopping') return finishShoppingMark(userId, dialogue);
    if (dialogue.domain === 'todo') return finishTodoMark(userId, dialogue);
  }
  if (dialogue.step === 'ready_to_remove') {
    if (dialogue.domain === 'shopping') return finishShoppingRemove(userId, dialogue);
    if (dialogue.domain === 'todo') return finishTodoRemove(userId, dialogue);
  }
  if (dialogue.step === 'ready_to_clear') {
    if (dialogue.domain === 'shopping') return finishShoppingClear(userId, dialogue);
    if (dialogue.domain === 'todo') return finishTodoClear(userId, dialogue);
  }
  return {
    dialogue,
    done: false,
    prompt: promptForListStep(dialogue),
  };
}

module.exports = {
  SHOPPING_STEPS,
  TODO_STEPS,
  startShoppingAdd,
  startTodoAdd,
  startShoppingMark,
  startTodoMark,
  startShoppingRemove,
  startTodoRemove,
  startShoppingClear,
  startTodoClear,
  promptForListStep,
  openReprompt,
  applyListAnswer,
  prepareAndMaybeFinish,
  presentGetShopping,
  presentGetTodo,
  respondWithListResult,
};
