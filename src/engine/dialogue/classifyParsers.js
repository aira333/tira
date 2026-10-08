// apps/skill-backend/src/dialogue/classifyParsers.js
// Idle-classify helpers (extracted from classify.js — behavior-preserving)


const STORE_HINT =
  /\b(target|costco|walmart|trader|whole foods|kroger|safeway|aldi|publix|shopping|shoppng|shoping|shoping|grocery|store)\b/i;

/** Misspellings / synonyms that mean "shopping list", not a to-do list name */
const SHOPPING_LIST_CUE =
  /\b(shopping|shoppng|shoping|shoppping|grocery)\s+lists?\b|\b(shopping|shoppng|shoping)\b/i;

function isShoppingListCue(u) {
  return SHOPPING_LIST_CUE.test(u) || STORE_HINT.test(u);
}

function looksLikeShoppingListName(name) {
  return /^(shopping|shoppng|shoping|shoppping|grocery|store)$/i.test(
    String(name || '').trim(),
  );
}

function looksLikeScheduleUtterance(u) {
  return (
    /\b(add|schedule|book|create|need|set\s*up|set up|make)\b/.test(u) &&
    (/\bappointments?\b/.test(u) ||
      /\bappoinments?\b/.test(u) ||
      /\bcheckup\b/.test(u) ||
      /\bwith\b/.test(u))
  );
}

/** Past list queries — not scheduling (e.g. "add … yesterday"). */
function isPastAppointmentsQuery(u) {
  if (looksLikeScheduleUtterance(u)) return false;
  if (!/\bappointments?\b/.test(u) && !/\bappoinments?\b/.test(u)) return false;
  return (
    /\b(last\s+(week|month|year)|yesterday|did\s+i\s+have|in\s+the\s+past|past\s+appointments?|previous\s+appointments?)\b/.test(
      u,
    ) || /\bpast\b/.test(u)
  );
}

/** Weekly / every-weekday recurring — not supported. */
function isRecurringAppointmentRequest(u) {
  const recurringCue =
    /\b(weekly|recurring|every\s+week|each\s+week|every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/.test(
      u,
    );
  if (!recurringCue) return false;
  return (
    looksLikeScheduleUtterance(u) ||
    /\bappointments?\b/.test(u) ||
    /\bappoinments?\b/.test(u) ||
    /\b(dr\.?|doctor)\b/.test(u)
  );
}

const RIDE_WHEN_RE =
  /\s+(?:(?:on\s+)?(?:today|tonight|tomorrow|day after tomorrow)|(?:on\s+|this\s+|next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\b.*$/i;

/** "the library tomorrow at 10 am" → { destination, pickupDate, pickupTime } */
function splitRideDestination(raw) {
  const text = String(raw || '');
  const m = text.match(RIDE_WHEN_RE);
  if (!m || m.index === 0) return { destination: text };
  const destination = text.slice(0, m.index).trim();
  const when = m[0].trim();
  const dateWord = when.match(
    /\b(today|tonight|tomorrow|day after tomorrow|(?:this\s+|next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i,
  );
  const timeWord = when.match(/\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\s*$/i);
  const pickupDate = dateWord ? dateWord[1].toLowerCase().replace(/^tonight$/, 'today') : null;
  const pickupTime = timeWord ? timeWord[1].trim() : null;
  return { destination, pickupDate, pickupTime };
}

function parseRideUtterance(text, u) {
  // Rider phone
  if (
    /\b(my phone|phone number|callback number|call me at)\b/.test(u) ||
    (/^(save|set|use)\b/.test(u) && /\b(phone|number)\b/.test(u))
  ) {
    const phone = extractPhone(text);
    return { action: 'set_rider_phone', slots: { riderPhone: phone } };
  }

  // Transport service
  if (
    /\b(my transport|transport service|ride service|ride number|transport number)\b/.test(u) ||
    (/\b(save|set|use)\b/.test(u) && /\b(transport|ride)\b/.test(u))
  ) {
    const phone = extractPhone(text);
    let transportName = null;
    const named =
      text.match(
        /\b(?:transport(?:\s+service)?|ride(?:\s+service)?)\s+(?:is\s+|as\s+|to\s+)?([A-Za-z][A-Za-z0-9\s]{1,40}?)(?:\s+number|\s+\d|$)/i,
      ) ||
      text.match(/\b(?:save|set|use)\s+(?:transport\s+)?([A-Za-z][A-Za-z0-9\s]{1,40}?)(?:\s+for rides|\s+number|$)/i);
    if (named) {
      transportName = named[1].trim().replace(/\s+number$/i, '');
    }
    if (!transportName && !phone) {
      return { action: 'set_transport', slots: {} };
    }
    return {
      action: 'set_transport',
      slots: { transportName, transportPhone: phone },
    };
  }

  // Request ride to location (explicit place, not appointment / not doctor)
  if (
    /\b(ride|transport|uber|lyft)\b/.test(u) &&
    /\b(to|for)\b/.test(u) &&
    !/\bappointment\b/.test(u) &&
    !/\b(dr\.?|doctor)\b/.test(u)
  ) {
    const dest =
      text.match(/\b(?:ride|transport)\s+to\s+(.+)/i) ||
      text.match(/\bto\s+(.+?)(?:\s+at\s+|\s+on\s+|$)/i);
    const destination = dest ? dest[1].trim() : null;
    // "book a ride" / "request a ride" with no place → appointment path (falls back to destination)
    if (!destination || /^(a\s+)?ride\b/i.test(destination)) {
      return { action: 'request_ride_appointment', slots: {} };
    }
    return {
      action: 'request_ride_location',
      slots: splitRideDestination(destination),
    };
  }

  // Request ride to appointment (or generic "book a ride" → try appointment, then place)
  if (
    (/\b(ride|transport|transportation)\b/.test(u) &&
      (/\bappointment\b/.test(u) ||
        /\b(request|need|call|book)\b/.test(u) ||
        /\b(dr\.?|doctor)\b/.test(u))) ||
    /\brequest a ride\b/.test(u) ||
    /\bi need a ride\b/.test(u) ||
    /\bbook a ride\b/.test(u) ||
    /\bcall (my )?(ride|transport)/.test(u)
  ) {
    let doctorName = null;
    const doc =
      text.match(/\b(?:with\s+)?(?:Dr\.?|Doctor)\s+([A-Za-z]+)/i) ||
      text.match(/\bappointment\s+with\s+([A-Za-z]+)/i);
    if (doc) doctorName = doc[1].trim();
    return {
      action: 'request_ride_appointment',
      slots: { doctorName },
    };
  }

  return null;
}

function extractPhone(text) {
  const m = String(text || '').match(
    /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
  );
  return m ? m[0].replace(/[^\d+]/g, '') : null;
}

function parseRemoveOrClearUtterance(text, u) {
  if (/\bappointment\b/.test(u)) return null;

  const isClear =
    (/\bclear\b/.test(u) &&
      /\b(completed|checked off|done items|finished items)\b/.test(u)) ||
    (/\b(remove|delete)\b/.test(u) &&
      /\b(completed items|checked off|done items|finished items)\b/.test(u));

  if (isClear) {
    const isTodo =
      /\bto[\s-]?do\b/.test(u) ||
      /\btodo\b/.test(u) ||
      (/\bon my\s+\w+\s+list\b/.test(u) && !STORE_HINT.test(u) && !/\bshopping\b/.test(u));
    const isShopping =
      /\bshopping\b/.test(u) || STORE_HINT.test(u);

    let listOrStore = null;
    const m = text.match(/\b(?:on|from|for)\s+(?:my\s+|the\s+)?(.+?)\s+list\b/i);
    if (m) {
      listOrStore = m[1].trim().replace(/\bto[\s-]?do\b/i, '').trim() || null;
      if (/^(shopping|shoppng|grocery|to|do|todo)$/i.test(listOrStore || '')) {
        listOrStore = null;
      }
    }

    if (isShopping || STORE_HINT.test(u)) {
      return {
        action: 'clear_shopping_completed',
        slots: { storeName: listOrStore, raw: text },
      };
    }
    return {
      action: 'clear_todo_completed',
      slots: { listName: listOrStore || 'to do', raw: text },
    };
  }

  if (!/\b(remove|delete|take off|take out)\b/.test(u)) return null;
  if (
    !/\blist\b/.test(u) &&
    !STORE_HINT.test(u) &&
    !/\bto[\s-]?do\b/.test(u) &&
    !/\btodo\b/.test(u)
  ) {
    return null;
  }

  const isTodo =
    /\bto[\s-]?do\b/.test(u) ||
    /\btodo\b/.test(u) ||
    (/\bon my\s+\w+\s+list\b/.test(u) && !STORE_HINT.test(u) && !/\bshopping\b/.test(u));
  const isShopping = /\bshopping\b/.test(u) || STORE_HINT.test(u);

  let itemName = null;
  let listOrStore = null;

  let m = text.match(
    /\b(?:remove|delete|take off|take out)\s+(.+?)\s+(?:from|off|on)\s+(?:my\s+|the\s+)?(.+?)\s+list\b/i,
  );
  if (m) {
    itemName = m[1].trim();
    listOrStore = m[2].trim().replace(/\bto[\s-]?do\b/i, '').trim() || null;
  }
  if (!itemName) {
    m = text.match(/\b(?:remove|delete|take off|take out)\s+(.+?)(?:\s+from\s+|\s+off\s+|$)/i);
    if (m) itemName = m[1].replace(/\s+list\b/i, '').trim();
  }
  if (!listOrStore) {
    m = text.match(/\b(?:from|off|on)\s+(?:my\s+|the\s+)?(.+?)\s+list\b/i);
    if (m) {
      listOrStore = m[1].trim().replace(/\bto[\s-]?do\b/i, '').trim() || null;
    }
  }
  if (listOrStore && /^(shopping|shoppng|grocery|to|do|todo)$/i.test(listOrStore)) {
    listOrStore = null;
  }

  if (isShopping || STORE_HINT.test(u)) {
    return {
      action: 'remove_shopping_item',
      slots: {
        storeName: listOrStore,
        itemName,
        raw: text,
      },
    };
  }

  if (isTodo || itemName) {
    return {
      action: 'remove_todo_item',
      slots: {
        listName: listOrStore || 'to do',
        itemName,
        raw: text,
      },
    };
  }

  return null;
}

function parseMarkCompleteUtterance(text, u) {
  if (
    !/\b(mark|check off|cross off|finished|complete|done|picked up|i got)\b/.test(u)
  ) {
    return null;
  }

  const isTodo =
    /\bto[\s-]?do\b/.test(u) ||
    /\btodo\b/.test(u) ||
    (/\bon my\s+\w+\s+list\b/.test(u) && !STORE_HINT.test(u) && !/\bshopping\b/.test(u));
  const isShopping =
    /\bshopping\b/.test(u) || STORE_HINT.test(u) || /\bfrom\s+\w+\s+list\b/.test(u);

  let itemName = null;
  let listOrStore = null;

  let m = text.match(
    /\b(?:mark|check off|cross off)\s+(.+?)\s+(?:as\s+)?(?:done|complete|finished)\b/i,
  );
  if (m) itemName = m[1].trim();
  if (!itemName) {
    m = text.match(/\b(?:i finished|i got|i picked up)\s+(.+?)(?:\s+on\s+|\s+from\s+|$)/i);
    if (m) itemName = m[1].trim();
  }

  m = text.match(/\b(?:on|from)\s+(?:my\s+|the\s+)?(.+?)\s+list\b/i);
  if (m) listOrStore = m[1].trim().replace(/\bto[\s-]?do\b/i, '').trim() || null;

  if (isTodo || (!isShopping && /\blist\b/.test(u))) {
    return {
      action: 'mark_todo_done',
      slots: {
        listName: listOrStore || 'to do',
        itemName,
        raw: text,
      },
    };
  }

  if (isShopping || STORE_HINT.test(u)) {
    return {
      action: 'mark_shopping_done',
      slots: {
        storeName: listOrStore || null,
        itemName,
        raw: text,
      },
    };
  }

  // Ambiguous "mark X done" → prefer todo default list
  if (itemName) {
    return {
      action: 'mark_todo_done',
      slots: { listName: 'to do', itemName, raw: text },
    };
  }

  return null;
}

function parseGetListUtterance(text, u) {
  // Never treat add/create as a get
  if (/\b(add|put|create|make|start|new)\b/.test(u)) {
    return null;
  }

  const isQuery =
    /\b(what('|’)s|what is|what do i|show|read|list|get)\b/.test(u) ||
    /\bon my\b/.test(u);
  if (!isQuery && !/\bshopping lists?\b/.test(u) && !/\bto[\s-]?do lists?\b/.test(u)) {
    return null;
  }

  // Shopping
  if (
    /\bshopping\b/.test(u) ||
    (STORE_HINT.test(u) && /\blist\b/.test(u)) ||
    /\bwhat do i need (from|at)\b/.test(u)
  ) {
    // Creating a list is not a get
    if (/\bshopping\s+list\s+for\b/.test(u) || /\b(new|start|create)\b.*\blist\b/.test(u)) {
      return null;
    }
    let storeName = null;
    const m =
      text.match(/\b(?:my|the)\s+(.+?)\s+(?:shopping\s+)?list\b/i) ||
      text.match(/\b(?:from|at)\s+(.+)$/i);
    if (m) {
      storeName = m[1].trim();
      if (/^(shopping|to[\s-]?do|todo)$/i.test(storeName)) storeName = null;
    }
    if (/\ball\b.*\bshopping\b/.test(u) || /\bshopping lists\b/.test(u)) {
      storeName = 'all';
    }
    return { action: 'get_shopping', slots: { storeName, raw: text } };
  }

  // To-do
  if (
    /\bto[\s-]?do\b/.test(u) ||
    /\btodo\b/.test(u) ||
    (/\blist\b/.test(u) &&
      /\b(what|show|read|on my|back)\b/.test(u) &&
      !/\bappointments?\b/.test(u) &&
      !STORE_HINT.test(u) &&
      !SHOPPING_LIST_CUE.test(u))
  ) {
    let listName = null;
    const m = text.match(/\b(?:my|the)\s+(.+?)\s+(?:to[\s-]?do\s+|todo\s+)?list\b/i);
    if (m) {
      listName = m[1].trim();
      if (/^(to[\s-]?do|todo|to|do)$/i.test(listName)) listName = 'to do';
    }
    // "read my list" / "read me back my list" with no name → default to do list
    if (
      !listName &&
      /\b(my|the)\s+list\b/.test(u) &&
      !/\bshopping\b/.test(u)
    ) {
      listName = 'to do';
    }
    if (/\ball\b.*\b(to[\s-]?do|todo|lists)\b/.test(u)) listName = 'all';
    if (!listName && /\bto[\s-]?do\b/.test(u)) listName = 'to do';
    return { action: 'get_todo', slots: { listName, raw: text } };
  }

  return null;
}

function parseTodoAddUtterance(text, u) {
  // "shopping" / "shoppng" lists are shopping domain, not todo
  if (SHOPPING_LIST_CUE.test(u)) return null;

  const hasTodoCue =
    /\bto[\s-]?do\s+list\b/.test(u) ||
    /\btodo\s+list\b/.test(u) ||
    (/\b(add|put|create)\b/.test(u) &&
      /\bto\s+(?:my\s+|the\s+)\w+\s+list\b/.test(u) &&
      !isShoppingListCue(u));

  if (!hasTodoCue) return null;
  if (!/\b(add|put|create|make|need)\b/.test(u)) return null;

  let listName = 'to do';
  let items = null;

  // Prefer explicit "to do list" / "todo list" endings (never capture "do" as the list name)
  let m = text.match(
    /\b(?:add|put|create)\s+(.+?)\s+to\s+(?:my\s+|the\s+)?to[\s-]?do\s+list\b/i,
  );
  if (m) {
    items = m[1].trim();
    listName = 'to do';
  }

  if (!items) {
    m = text.match(
      /\b(?:add|put|create)\s+(.+?)\s+to\s+(?:my\s+|the\s+)?todo\s+list\b/i,
    );
    if (m) {
      items = m[1].trim();
      listName = 'to do';
    }
  }

  // "add X to my work to do list"
  if (!items) {
    m = text.match(
      /\b(?:add|put|create)\s+(.+?)\s+to\s+(?:my\s+|the\s+)?(\w+)\s+to[\s-]?do\s+list\b/i,
    );
    if (m) {
      items = m[1].trim();
      const named = m[2].trim();
      if (!/^(to|do|todo)$/i.test(named) && !looksLikeShoppingListName(named)) {
        listName = named;
      }
    }
  }

  // "add X to my work list" (named list, not shopping)
  if (!items) {
    m = text.match(
      /\b(?:add|put|create)\s+(.+?)\s+to\s+(?:my\s+|the\s+)?(\w+)\s+list\b/i,
    );
    if (m) {
      items = m[1].trim();
      const named = m[2].trim();
      if (/^(to|do|todo)$/i.test(named)) {
        listName = 'to do';
      } else if (looksLikeShoppingListName(named)) {
        return null;
      } else {
        listName = named;
      }
    }
  }

  if (!items) {
    m =
      text.match(/\bto[\s-]?do\s+list\s+(?:of\s+|with\s+)?(.+)/i) ||
      text.match(/\btodo\s+list\s+(?:of\s+|with\s+)?(.+)/i);
    if (m) items = m[1].trim();
  }

  if (items) {
    items = items.replace(/^(?:of|with)\s+/i, '').trim();
  }
  if (!items) items = null;

  // Guard: never persist a bogus list name from "to do"
  if (/^(to|do|todo)$/i.test(listName)) listName = 'to do';

  return {
    action: 'add_todo',
    slots: { listName, items, raw: text },
  };
}

function parseShoppingAddUtterance(text, u) {
  const shoppingListWord =
    '(?:shopping|shoppng|shoping|shoppping|grocery)';

  // "add milk to my Target shopping list" (store + items in one breath)
  const addToStoreShopList = text.match(
    new RegExp(
      `\\b(?:add|put)\\s+(.+?)\\s+to\\s+(?:my\\s+|the\\s+)?(.+?)\\s+${shoppingListWord}\\s+list\\b`,
      'i',
    ),
  );
  if (addToStoreShopList && !/^(?:my|the)$/i.test(addToStoreShopList[2].trim())) {
    return {
      action: 'add_shopping',
      slots: {
        storeName: addToStoreShopList[2].trim(),
        items: addToStoreShopList[1].trim(),
        raw: text,
      },
    };
  }

  // "add milk to my shopping/shoppng list" (store unknown → elicit store)
  const addToShopList = text.match(
    new RegExp(
      `\\b(?:add|put)\\s+(.+?)\\s+to\\s+(?:my\\s+|the\\s+)?${shoppingListWord}\\s+list\\b`,
      'i',
    ),
  );
  if (addToShopList) {
    return {
      action: 'add_shopping',
      slots: {
        storeName: null,
        items: addToShopList[1].trim(),
        raw: text,
      },
    };
  }

  // "shopping list for Target" / "new Target shopping list"
  if (
    new RegExp(`\\b${shoppingListWord}\\s+list\\s+for\\b`, 'i').test(u) ||
    new RegExp(`\\b(?:new|start|create)\\b.*\\b${shoppingListWord}\\s+list\\b`, 'i').test(
      u,
    ) ||
    new RegExp(`\\b${shoppingListWord}\\s+list\\b`, 'i').test(u)
  ) {
    if (
      !/\b(add|put|create|make|start|new|need)\b/.test(u) &&
      !new RegExp(`\\b${shoppingListWord}\\s+list\\s+for\\b`, 'i').test(u)
    ) {
      if (!/\b(for|with|of)\b/.test(u)) return null;
    }
  } else if (!/\b(add|put|create|start|new)\b/.test(u)) {
    return null;
  }

  if (new RegExp(`\\b${shoppingListWord}\\s+list\\b`, 'i').test(u)) {
    const forStore = text.match(
      new RegExp(`\\b${shoppingListWord}\\s+list\\s+for\\s+(.+)`, 'i'),
    );
    if (forStore) {
      return {
        action: 'add_shopping',
        slots: {
          storeName: forStore[1].trim(),
          items: null,
          raw: text,
        },
      };
    }
    const m = text.match(
      new RegExp(`\\b${shoppingListWord}\\s+list\\s+(?:of\\s+|with\\s+)?(.+)`, 'i'),
    );
    const rest = m
      ? m[1].trim().replace(/^(?:of|with|for)\s+/i, '').trim()
      : text.replace(new RegExp(`.*${shoppingListWord}\\s+list`, 'i'), '').trim() ||
        null;
    if (
      rest &&
      !/\b(add|put)\b/.test(u) &&
      /^[A-Za-z][A-Za-z\s']+$/.test(rest) &&
      rest.split(/\s+/).length <= 3
    ) {
      return {
        action: 'add_shopping',
        slots: { storeName: rest, items: null, raw: text },
      };
    }
    return {
      action: 'add_shopping',
      slots: { storeName: null, items: rest, raw: text },
    };
  }

  if (!/\b(add|put|create)\b/.test(u)) return null;

  const storeList = text.match(
    /\b(?:add|put)\s+(.+?)\s+to\s+(?:my\s+|the\s+)?(.+?)\s+list\b/i,
  );
  if (storeList) {
    const storeName = storeList[2].trim();
    const items = storeList[1].trim();
    if (
      looksLikeShoppingListName(storeName) ||
      STORE_HINT.test(storeName) ||
      isShoppingListCue(u)
    ) {
      return {
        action: 'add_shopping',
        slots: {
          storeName: looksLikeShoppingListName(storeName) ? null : storeName,
          items,
          raw: text,
        },
      };
    }
  }

  return null;
}

module.exports = {
  STORE_HINT,
  SHOPPING_LIST_CUE,
  isShoppingListCue,
  looksLikeShoppingListName,
  looksLikeScheduleUtterance,
  isPastAppointmentsQuery,
  isRecurringAppointmentRequest,
  parseRideUtterance,
  extractPhone,
  parseRemoveOrClearUtterance,
  parseMarkCompleteUtterance,
  parseGetListUtterance,
  parseTodoAddUtterance,
  parseShoppingAddUtterance,
};
