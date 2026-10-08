// apps/skill-backend/src/dialogue/todoListFlow.js
// Todo multi-turn dialogue (extracted from listFlow.js)

const todoService = require('../modules/todo/todo.service');
const prompts = require('./prompts');
const {
  TODO_STEPS,
  formatSpeech,
  openReprompt,
} = require('./listShared');
const safeLog = require('../log');

function startTodoAdd({ listName = null, items = null } = {}) {
  const slots = {
    listName: listName || null,
    items: items || null,
    mode: 'add',
  };
  let step = TODO_STEPS.LIST;
  if (slots.listName && slots.items) {
    step = 'ready_to_save';
  } else if (slots.listName) {
    step = TODO_STEPS.ITEMS;
  } else if (slots.items) {
    step = TODO_STEPS.LIST;
  }
  return { domain: 'todo', step, slots, promptId: step };
}

function startTodoMark({ listName = null, itemName = null } = {}) {
  const slots = { listName: listName || null, itemName: itemName || null, mode: 'mark' };
  let step = TODO_STEPS.MARK_LIST;
  if (slots.listName && slots.itemName) step = 'ready_to_mark';
  else if (slots.listName) step = TODO_STEPS.MARK_ITEM;
  else if (slots.itemName) step = TODO_STEPS.MARK_LIST;
  return { domain: 'todo', step, slots, promptId: step };
}

function startTodoRemove({ listName = null, itemName = null } = {}) {
  const slots = { listName: listName || null, itemName: itemName || null, mode: 'remove' };
  let step = TODO_STEPS.REMOVE_LIST;
  if (slots.listName && slots.itemName) step = 'ready_to_remove';
  else if (slots.listName) step = TODO_STEPS.REMOVE_ITEM;
  else if (slots.itemName) step = TODO_STEPS.REMOVE_LIST;
  return { domain: 'todo', step, slots, promptId: step };
}

function startTodoClear({ listName = null } = {}) {
  const slots = { listName: listName || null, mode: 'clear' };
  const step = slots.listName ? 'ready_to_clear' : TODO_STEPS.CLEAR_LIST;
  return { domain: 'todo', step, slots, promptId: step };
}

async function finishTodoAdd(userId, dialogue) {
  const { listName, items } = dialogue.slots;
  try {
    const itemNames = todoService.parseItemsList(items);
    if (itemNames.length === 0) {
      dialogue.step = TODO_STEPS.ITEMS;
      return {
        dialogue,
        done: false,
        prompt: {
          speak: "I didn't catch any items. Please try again and list the things you want to add.",
          reprompt: 'What would you like to add?',
        },
      };
    }
    const { existingList } = await todoService.addItemsToList(userId, listName, itemNames);
    const speech = todoService.formatAddConfirmationForSpeech(
      listName,
      itemNames,
      existingList,
    );
    const open = openReprompt('todo', listName);
    return {
      dialogue: {
        domain: 'todo',
        step: TODO_STEPS.MORE,
        slots: { listName, items: null, mode: 'add' },
        promptId: TODO_STEPS.MORE,
      },
      done: false,
      prompt: { speak: speech + open.speakExtra, reprompt: open.reprompt },
    };
  } catch (err) {
    safeLog.error('todo_add_failed', {
      errorMessage: err?.message,
      errorName: err?.name,
    });
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: {
        speak: "I'm sorry, I had trouble saving your to do list. Please try again.",
        reprompt: prompts.OPEN_REPROMPT,
      },
    };
  }
}

async function finishTodoMark(userId, dialogue) {
  const { listName, itemName } = dialogue.slots;
  try {
    const { success, itemName: foundName, alreadyDone } =
      await todoService.markItemCompleted(userId, listName, itemName);
    const open = openReprompt('todo', listName);
    if (!success) {
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak: `I couldn't find "${itemName}" on your ${listName} list. Please check the item name and try again.`,
          reprompt: open.reprompt,
        },
      };
    }
    const speak = alreadyDone
      ? `${foundName} was already marked as done on your ${listName} list.`
      : `Got it! I've marked ${foundName} as done on your ${listName} list.`;
    return {
      dialogue: {
        domain: 'todo',
        step: TODO_STEPS.MORE,
        slots: { listName, items: null, mode: 'add' },
        promptId: TODO_STEPS.MORE,
      },
      done: false,
      prompt: { speak: speak + open.speakExtra, reprompt: open.reprompt },
    };
  } catch (err) {
    safeLog.error('todo_mark_failed', {
      errorMessage: err?.message,
      errorName: err?.name,
    });
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: {
        speak: 'I had trouble updating your to do list. Please try again.',
        reprompt: prompts.OPEN_REPROMPT,
      },
    };
  }
}

async function finishTodoRemove(userId, dialogue) {
  const { listName, itemName } = dialogue.slots;
  try {
    const { success, itemName: foundName } = await todoService.removeItem(
      userId,
      listName,
      itemName,
    );
    const open = openReprompt('todo', listName);
    if (!success) {
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak: `I couldn't find "${itemName}" on your ${listName} list. Please check the item name and try again.`,
          reprompt: open.reprompt,
        },
      };
    }
    return {
      dialogue: {
        domain: 'todo',
        step: TODO_STEPS.MORE,
        slots: { listName, items: null, mode: 'add' },
        promptId: TODO_STEPS.MORE,
      },
      done: false,
      prompt: {
        speak: `Removed ${foundName} from your ${listName} list.${open.speakExtra}`,
        reprompt: open.reprompt,
      },
    };
  } catch (err) {
    safeLog.error('todo_remove_failed', {
      errorMessage: err?.message,
      errorName: err?.name,
    });
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: {
        speak: 'I had trouble updating your to do list. Please try again.',
        reprompt: prompts.OPEN_REPROMPT,
      },
    };
  }
}

async function finishTodoClear(userId, dialogue) {
  const { listName } = dialogue.slots;
  try {
    const { success, clearedCount, listName: foundList } =
      await todoService.clearCompletedItems(userId, listName);
    const open = openReprompt('todo', foundList || listName);
    if (!success) {
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak: `I couldn't find a to do list named ${listName}.`,
          reprompt: open.reprompt,
        },
      };
    }
    const speak =
      clearedCount === 0
        ? `There were no completed items on your ${foundList} list.`
        : `Cleared ${clearedCount} completed ${clearedCount === 1 ? 'item' : 'items'} from your ${foundList} list.`;
    return {
      dialogue: {
        domain: 'todo',
        step: TODO_STEPS.MORE,
        slots: { listName: foundList, items: null, mode: 'add' },
        promptId: TODO_STEPS.MORE,
      },
      done: false,
      prompt: { speak: speak + open.speakExtra, reprompt: open.reprompt },
    };
  } catch (err) {
    safeLog.error('todo_clear_failed', {
      errorMessage: err?.message,
      errorName: err?.name,
    });
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: {
        speak: 'I had trouble updating your to do list. Please try again.',
        reprompt: prompts.OPEN_REPROMPT,
      },
    };
  }
}

async function presentTodoPage(userId, listName, page = 0) {
  const list = await todoService.getListByName(userId, listName);
  if (!list) {
    const label = listName || 'that';
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: {
        speak: `I don't have a ${label} to do list yet. You can say: add call the pharmacy to my ${label} to do list. What else can I help you with?`,
        reprompt: prompts.OPEN_REPROMPT,
      },
    };
  }

  const formatted = todoService.formatListForSpeech(list, { page });
  const speech = formatSpeech(formatted);
  const open = openReprompt('todo', listName);

  if (formatted.more) {
    return {
      dialogue: {
        domain: 'todo',
        step: TODO_STEPS.READ_PAGE,
        slots: { listName, mode: 'read', page },
        promptId: TODO_STEPS.READ_PAGE,
      },
      done: false,
      prompt: {
        speak: `${speech} Say next for more.`,
        reprompt: 'Say next for more items, previous to go back, or stop.',
      },
    };
  }

  return {
    dialogue: {
      domain: 'todo',
      step: TODO_STEPS.MORE,
      slots: { listName, items: null, mode: 'add' },
      promptId: TODO_STEPS.MORE,
    },
    done: false,
    prompt: { speak: speech + open.speakExtra, reprompt: open.reprompt },
  };
}

async function presentGetTodo(userId, listName) {
  if (!listName || ['all', 'everything', 'any'].includes(String(listName).toLowerCase())) {
    try {
      const allLists = await todoService.getAllLists(userId);
      if (allLists.length === 0) {
        return {
          dialogue: { domain: null, step: null, slots: {} },
          done: true,
          prompt: {
            speak:
              "You don't have any to do lists yet. You can say: add call the pharmacy to my to do list. What else can I help you with?",
            reprompt: prompts.OPEN_REPROMPT,
          },
        };
      }
      const listNames = allLists.map((l) => l.listName).join(', ');
      const totalItems = allLists.reduce((sum, l) => sum + (l.items || []).length, 0);
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak: `You have ${allLists.length} to do ${allLists.length === 1 ? 'list' : 'lists'} with ${totalItems} total items: ${listNames}. What else can I help you with?`,
          reprompt: prompts.OPEN_REPROMPT,
        },
      };
    } catch (err) {
      safeLog.error('todo_get_all_failed', {
        errorMessage: err?.message,
        errorName: err?.name,
      });
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak: "I couldn't retrieve your to do lists. Please try again.",
          reprompt: prompts.OPEN_REPROMPT,
        },
      };
    }
  }

  try {
    return await presentTodoPage(userId, listName, 0);
  } catch (err) {
    safeLog.error('todo_get_failed', {
      errorMessage: err?.message,
      errorName: err?.name,
    });
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: {
        speak: `I had trouble getting your ${listName} list. Please try again.`,
        reprompt: prompts.OPEN_REPROMPT,
      },
    };
  }
}

module.exports = {
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
};
