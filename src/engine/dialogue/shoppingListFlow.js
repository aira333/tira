// apps/skill-backend/src/dialogue/shoppingListFlow.js
// Shopping multi-turn dialogue (extracted from listFlow.js)

const shoppingService = require('../modules/shopping/shopping.service');
const prompts = require('./prompts');
const {
  SHOPPING_STEPS,
  formatSpeech,
  openReprompt,
} = require('./listShared');
const safeLog = require('../log');

function startShoppingAdd({ storeName = null, items = null } = {}) {
  const slots = { storeName: storeName || null, items: items || null, mode: 'add' };
  let step = SHOPPING_STEPS.STORE;
  if (slots.storeName && slots.items) {
    step = 'ready_to_save';
  } else if (slots.storeName) {
    step = SHOPPING_STEPS.ITEMS;
  } else if (slots.items) {
    step = SHOPPING_STEPS.STORE;
  }
  return { domain: 'shopping', step, slots, promptId: step };
}

function startShoppingMark({ storeName = null, itemName = null } = {}) {
  const slots = { storeName: storeName || null, itemName: itemName || null, mode: 'mark' };
  let step = SHOPPING_STEPS.MARK_STORE;
  if (slots.storeName && slots.itemName) step = 'ready_to_mark';
  else if (slots.storeName) step = SHOPPING_STEPS.MARK_ITEM;
  else if (slots.itemName) step = SHOPPING_STEPS.MARK_STORE;
  return { domain: 'shopping', step, slots, promptId: step };
}

function startShoppingRemove({ storeName = null, itemName = null } = {}) {
  const slots = { storeName: storeName || null, itemName: itemName || null, mode: 'remove' };
  let step = SHOPPING_STEPS.REMOVE_STORE;
  if (slots.storeName && slots.itemName) step = 'ready_to_remove';
  else if (slots.storeName) step = SHOPPING_STEPS.REMOVE_ITEM;
  else if (slots.itemName) step = SHOPPING_STEPS.REMOVE_STORE;
  return { domain: 'shopping', step, slots, promptId: step };
}

function startShoppingClear({ storeName = null } = {}) {
  const slots = { storeName: storeName || null, mode: 'clear' };
  const step = slots.storeName ? 'ready_to_clear' : SHOPPING_STEPS.CLEAR_STORE;
  return { domain: 'shopping', step, slots, promptId: step };
}

async function finishShoppingAdd(userId, dialogue) {
  const { storeName, items } = dialogue.slots;
  try {
    const itemNames = shoppingService.parseItemsList(items);
    if (itemNames.length === 0) {
      dialogue.step = SHOPPING_STEPS.ITEMS;
      return {
        dialogue,
        done: false,
        prompt: {
          speak: "I didn't catch any items. Please try again and list the items you want to add.",
          reprompt: 'What items would you like to add?',
        },
      };
    }
    const { existingList } = await shoppingService.addItemsToList(
      userId,
      storeName,
      itemNames,
    );
    const speech = shoppingService.formatAddConfirmationForSpeech(
      storeName,
      itemNames,
      existingList,
    );
    const open = openReprompt('shopping', storeName);
    return {
      dialogue: {
        domain: 'shopping',
        step: SHOPPING_STEPS.MORE,
        slots: { storeName, items: null, mode: 'add' },
        promptId: SHOPPING_STEPS.MORE,
      },
      done: false,
      prompt: { speak: speech + open.speakExtra, reprompt: open.reprompt },
    };
  } catch (err) {
    safeLog.error('shopping_add_failed', {
      errorMessage: err?.message,
      errorName: err?.name,
    });
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: {
        speak: "I'm sorry, I had trouble saving your shopping list. Please try again.",
        reprompt: prompts.OPEN_REPROMPT,
      },
    };
  }
}

async function finishShoppingMark(userId, dialogue) {
  const { storeName, itemName } = dialogue.slots;
  try {
    const { success, itemName: foundName, alreadyDone } =
      await shoppingService.markItemCompleted(userId, storeName, itemName);
    const open = openReprompt('shopping', storeName);
    if (!success) {
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak: `I couldn't find "${itemName}" on your ${storeName} list. Please check the item name and try again.`,
          reprompt: open.reprompt,
        },
      };
    }
    const speak = alreadyDone
      ? `${foundName} was already marked as done on your ${storeName} list.`
      : `Got it! I've marked ${foundName} as done on your ${storeName} list.`;
    return {
      dialogue: {
        domain: 'shopping',
        step: SHOPPING_STEPS.MORE,
        slots: { storeName, items: null, mode: 'add' },
        promptId: SHOPPING_STEPS.MORE,
      },
      done: false,
      prompt: { speak: speak + open.speakExtra, reprompt: open.reprompt },
    };
  } catch (err) {
    safeLog.error('shopping_mark_failed', {
      errorMessage: err?.message,
      errorName: err?.name,
    });
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: {
        speak: 'I had trouble updating your shopping list. Please try again.',
        reprompt: prompts.OPEN_REPROMPT,
      },
    };
  }
}

async function finishShoppingRemove(userId, dialogue) {
  const { storeName, itemName } = dialogue.slots;
  try {
    const { success, itemName: foundName } = await shoppingService.removeItem(
      userId,
      storeName,
      itemName,
    );
    const open = openReprompt('shopping', storeName);
    if (!success) {
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak: `I couldn't find "${itemName}" on your ${storeName} list. Please check the item name and try again.`,
          reprompt: open.reprompt,
        },
      };
    }
    return {
      dialogue: {
        domain: 'shopping',
        step: SHOPPING_STEPS.MORE,
        slots: { storeName, items: null, mode: 'add' },
        promptId: SHOPPING_STEPS.MORE,
      },
      done: false,
      prompt: {
        speak: `Removed ${foundName} from your ${storeName} list.${open.speakExtra}`,
        reprompt: open.reprompt,
      },
    };
  } catch (err) {
    safeLog.error('shopping_remove_failed', {
      errorMessage: err?.message,
      errorName: err?.name,
    });
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: {
        speak: 'I had trouble updating your shopping list. Please try again.',
        reprompt: prompts.OPEN_REPROMPT,
      },
    };
  }
}

async function finishShoppingClear(userId, dialogue) {
  const { storeName } = dialogue.slots;
  try {
    const { success, clearedCount, storeName: foundStore } =
      await shoppingService.clearCompletedItems(userId, storeName);
    const open = openReprompt('shopping', foundStore || storeName);
    if (!success) {
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak: `I couldn't find a shopping list for ${storeName}.`,
          reprompt: open.reprompt,
        },
      };
    }
    const speak =
      clearedCount === 0
        ? `There were no completed items on your ${foundStore} list.`
        : `Cleared ${clearedCount} completed ${clearedCount === 1 ? 'item' : 'items'} from your ${foundStore} list.`;
    return {
      dialogue: {
        domain: 'shopping',
        step: SHOPPING_STEPS.MORE,
        slots: { storeName: foundStore, items: null, mode: 'add' },
        promptId: SHOPPING_STEPS.MORE,
      },
      done: false,
      prompt: { speak: speak + open.speakExtra, reprompt: open.reprompt },
    };
  } catch (err) {
    safeLog.error('shopping_clear_failed', {
      errorMessage: err?.message,
      errorName: err?.name,
    });
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: {
        speak: 'I had trouble updating your shopping list. Please try again.',
        reprompt: prompts.OPEN_REPROMPT,
      },
    };
  }
}

async function presentShoppingPage(userId, storeName, page = 0) {
  const list = await shoppingService.getListByStore(userId, storeName);
  if (!list) {
    const label = storeName || 'that';
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: {
        speak: `I don't have a ${label} shopping list yet. You can say: add milk to my ${label} list. What else can I help you with?`,
        reprompt: prompts.OPEN_REPROMPT,
      },
    };
  }

  const formatted = shoppingService.formatListForSpeech(list, { page });
  const speech = formatSpeech(formatted);
  const open = openReprompt('shopping', storeName);

  if (formatted.more) {
    return {
      dialogue: {
        domain: 'shopping',
        step: SHOPPING_STEPS.READ_PAGE,
        slots: { storeName, mode: 'read', page },
        promptId: SHOPPING_STEPS.READ_PAGE,
      },
      done: false,
      prompt: {
        speak: `${speech} Say next for more.`,
        reprompt: 'Say next for more items, previous to go back, or stop.',
      },
    };
  }

  // After a successful read, stay open on add-more for that store (no Dialog.ElicitSlot).
  return {
    dialogue: {
      domain: 'shopping',
      step: SHOPPING_STEPS.MORE,
      slots: { storeName, items: null, mode: 'add' },
      promptId: SHOPPING_STEPS.MORE,
    },
    done: false,
    prompt: { speak: speech + open.speakExtra, reprompt: open.reprompt },
  };
}

async function presentGetShopping(userId, storeName) {
  if (!storeName || ['all', 'everything', 'any'].includes(String(storeName).toLowerCase())) {
    try {
      const allLists = await shoppingService.getAllLists(userId);
      if (allLists.length === 0) {
        return {
          dialogue: { domain: null, step: null, slots: {} },
          done: true,
          prompt: {
            speak:
              "You don't have any shopping lists yet. You can say: add milk to my Target list. What else can I help you with?",
            reprompt: prompts.OPEN_REPROMPT,
          },
        };
      }
      const storeNames = allLists.map((l) => l.storeName).join(', ');
      const totalItems = allLists.reduce((sum, l) => sum + (l.items || []).length, 0);
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak: `You have ${allLists.length} shopping ${allLists.length === 1 ? 'list' : 'lists'} with ${totalItems} total items: ${storeNames}. What else can I help you with?`,
          reprompt: prompts.OPEN_REPROMPT,
        },
      };
    } catch (err) {
      safeLog.error('shopping_get_all_failed', {
        errorMessage: err?.message,
        errorName: err?.name,
      });
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak: "I couldn't retrieve your shopping lists. Please try again.",
          reprompt: prompts.OPEN_REPROMPT,
        },
      };
    }
  }

  try {
    return await presentShoppingPage(userId, storeName, 0);
  } catch (err) {
    safeLog.error('shopping_get_failed', {
      errorMessage: err?.message,
      errorName: err?.name,
    });
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: {
        speak: `I had trouble getting your ${storeName} list. Please try again.`,
        reprompt: prompts.OPEN_REPROMPT,
      },
    };
  }
}

module.exports = {
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
};
