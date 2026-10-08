// apps/skill-backend/src/dialogue/rideFlow.js
// Ride setup + request flows on dialogue steps (greenfield Step 1.6b)

const {
  setTransportInfo,
  setRiderPhone,
  getRiderPhoneForUser,
  resolveTransportInfoForRide,
  getUpcomingAppointments,
  filterAppointmentsByDoctor,
  normalizePickupDate,
  normalizePickupTime,
  getAmbiguousPickupTime,
  resolveAmbiguousPickupTime,
  pickupDateTimeStatus,
  callTransportForAppointment,
  callTransportForLocation,
  formatAppointmentRideRequest,
  formatLocationRideRequest,
  formatTransportForSpeech,
  formatLastFourConfirmSpeech,
} = require('../modules/ride/ride.service');
const { sendProgress } = require('../libs/progressiveClient');
const { shouldAttemptRealTwilioHttp } = require('../store');
const prompts = require('./prompts');
const { normalizeUtterance } = require('./parsers');
const { matchDeleteCandidate } = require('./navFlow');
const {
  formatAppointmentForSpeech,
  getAppointmentById,
} = require('../modules/appointment/appointment.service');
const safeLog = require('../log');

const STEPS = {
  TRANSPORT_NAME: 'awaiting_transport_name',
  TRANSPORT_PHONE: 'awaiting_transport_phone',
  RIDER_PHONE: 'awaiting_rider_phone',
  DESTINATION: 'awaiting_destination',
  PICKUP_DATE: 'awaiting_pickup_date',
  PICKUP_TIME: 'awaiting_pickup_time',
  AMBIGUOUS_TIME: 'awaiting_ambiguous_meridiem',
  CHOICE: 'awaiting_ride_choice',
  CONFIRM: 'awaiting_ride_confirm',
};

/** Slim appointment fields for session (no notes/reminders/full row dump). */
function slimRideAppointment(apt) {
  if (!apt) return null;
  return {
    appointmentId: apt.appointmentId,
    doctorName: apt.doctorName,
    date: apt.date,
    time: apt.time,
    dateTime: apt.dateTime,
    location: apt.location,
    durationMinutes: apt.durationMinutes,
  };
}

function slimRideCandidate(apt, index) {
  return {
    index,
    ...slimRideAppointment(apt),
  };
}

function extractPhone(text) {
  const m = String(text || '').match(
    /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
  );
  return m ? m[0].replace(/[^\d+]/g, '') : null;
}

function isYes(text) {
  return /^(yes|yeah|yep|sure|ok|okay|confirm|do it|call)\b/i.test(
    normalizeUtterance(text),
  );
}

function isNo(text) {
  return /^(no|nope|cancel|never mind|don't|do not)\b/i.test(
    normalizeUtterance(text),
  );
}

function promptForRideStep(dialogue) {
  const { step, slots } = dialogue;
  switch (step) {
    case STEPS.TRANSPORT_NAME:
      return {
        speak:
          'What transport service should I use? For example, say Care Ride, or say the name of your agency transport.',
        reprompt: 'Please say the transport service name.',
      };
    case STEPS.TRANSPORT_PHONE:
      return {
        speak: `What phone number should I use for ${slots.transportName || 'your transport'}?`,
        reprompt: 'Please say the transport phone number, or say skip.',
      };
    case STEPS.RIDER_PHONE:
      return {
        speak:
          'What is your phone number? I will share it with your ride service if they need to call you back.',
        reprompt: 'Please say your phone number.',
      };
    case STEPS.DESTINATION: {
      const preface = slots.noUpcomingPreface
        ? `${slots.noUpcomingPreface} `
        : '';
      return {
        speak: `${preface}Where do you need a ride to?`,
        reprompt: 'Please say the destination.',
      };
    }
    case STEPS.PICKUP_DATE:
      return {
        speak: 'What date do you need the ride? For example, tomorrow.',
        reprompt: 'Please say a pickup date.',
      };
    case STEPS.PICKUP_TIME: {
      if (slots.rideType === 'appointment' && slots.appointment) {
        const appointmentDate = new Date(slots.appointment.dateTime);
        const appointmentTime = appointmentDate.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        });
        return {
          speak: `Your appointment is with ${slots.appointment.doctorName} at ${appointmentTime}. What time would you like to be picked up?`,
          reprompt: 'What time would you like your pickup?',
        };
      }
      return {
        speak: 'What time would you like to be picked up? For example, two P.M.',
        reprompt: 'Please say a pickup time.',
      };
    }
    case STEPS.AMBIGUOUS_TIME:
      return {
        speak: 'Was that A.M. or P.M.?',
        reprompt: 'Please say A.M. or P.M.',
      };
    case STEPS.CHOICE: {
      const list = (slots.candidates || [])
        .map(
          (c) =>
            `Number ${c.index}: ${formatAppointmentForSpeech({
              doctorName: c.doctorName,
              date: c.date,
              time: c.time,
              dateTime: c.dateTime,
            })}`,
        )
        .join('. ');
      return {
        speak: `You have more than one upcoming appointment. ${list}. Which appointment is this ride for? Say a number, or the date and time.`,
        reprompt: 'Say number 1, or the date and time of the appointment.',
      };
    }
    case STEPS.CONFIRM: {
      const transportText = formatTransportForSpeech(slots.transportInfo);
      const last4 = slots.lastFourSpeech || '';
      return {
        speak: `${slots.confirmSpeech} ${last4}Say yes to connect with ${transportText}, or no to cancel.`,
        reprompt: `Say yes to connect with ${transportText}, or no to cancel.`,
      };
    }
    default:
      return prompts.unclearIdle();
  }
}

/**
 * Start set-transport dialogue (or finish if enough info).
 */
function startSetTransport({ transportName = null, transportPhone = null } = {}) {
  const slots = { mode: 'setup_transport', transportName, transportPhone };
  if (!transportName && !transportPhone) {
    return {
      domain: 'ride',
      step: STEPS.TRANSPORT_NAME,
      slots,
      promptId: STEPS.TRANSPORT_NAME,
    };
  }
  if (transportName && !transportPhone) {
    return {
      domain: 'ride',
      step: STEPS.TRANSPORT_PHONE,
      slots,
      promptId: STEPS.TRANSPORT_PHONE,
    };
  }
  return {
    domain: 'ride',
    step: 'ready_save_transport',
    slots,
    promptId: 'ready_save_transport',
  };
}

function startSetRiderPhone({ riderPhone = null } = {}) {
  const slots = { mode: 'setup_rider', riderPhone };
  if (!riderPhone) {
    return {
      domain: 'ride',
      step: STEPS.RIDER_PHONE,
      slots,
      promptId: STEPS.RIDER_PHONE,
    };
  }
  return {
    domain: 'ride',
    step: 'ready_save_rider',
    slots,
    promptId: 'ready_save_rider',
  };
}

/**
 * Begin ride-to-appointment; may enter setup, choice, or pickup steps first.
 * @param {string} userId
 * @param {{ pickupTime?: string|null, doctorName?: string|null, appointment?: object|null }} opts
 */
async function prepareRideToAppointment(
  userId,
  { pickupTime = null, doctorName = null, appointment = null } = {},
) {
  const slots = {
    mode: 'request',
    rideType: 'appointment',
    pickupTime: pickupTime || null,
    doctorName: doctorName || null,
  };

  let transportInfo = await resolveTransportInfoForRide(userId, null, null);
  if (!transportInfo) {
    return {
      domain: 'ride',
      step: STEPS.TRANSPORT_NAME,
      slots: { ...slots, afterSetup: 'appointment' },
      promptId: STEPS.TRANSPORT_NAME,
    };
  }
  slots.transportInfo = transportInfo;

  // Tira runs on the rider's own phone: the rider number is optional.
  const riderPhone = await getRiderPhoneForUser(userId);
  slots.riderPhone = riderPhone;

  if (appointment) {
    slots.appointment = slimRideAppointment(appointment);
  } else {
    const upcoming = await getUpcomingAppointments(userId);
    const filtered = filterAppointmentsByDoctor(upcoming, doctorName);

    if (filtered.length === 0) {
      if (doctorName) {
        return {
          domain: 'ride',
          step: STEPS.DESTINATION,
          slots: {
            mode: 'request',
            rideType: 'location',
            transportInfo: slots.transportInfo,
            riderPhone,
            noUpcomingPreface: `I could not find an upcoming appointment with ${doctorName}.`,
          },
          promptId: STEPS.DESTINATION,
        };
      }
      return {
        domain: 'ride',
        step: STEPS.DESTINATION,
        slots: {
          mode: 'request',
          rideType: 'location',
          transportInfo: slots.transportInfo,
          riderPhone,
          noUpcomingPreface:
            'You do not have an upcoming appointment on your schedule.',
        },
        promptId: STEPS.DESTINATION,
      };
    }

    if (filtered.length > 1) {
      const candidates = filtered.map((apt, i) => slimRideCandidate(apt, i + 1));
      return {
        domain: 'ride',
        step: STEPS.CHOICE,
        slots: { ...slots, candidates },
        promptId: STEPS.CHOICE,
      };
    }

    slots.appointment = slimRideAppointment(filtered[0]);
  }

  const normalized = normalizePickupTime(slots.pickupTime);
  if (!normalized) {
    return {
      domain: 'ride',
      step: STEPS.PICKUP_TIME,
      slots,
      promptId: STEPS.PICKUP_TIME,
    };
  }
  slots.pickupTime = normalized;
  return buildConfirmDialogue(slots);
}

async function prepareRideToLocation(
  userId,
  { destination = null, pickupDate = null, pickupTime = null } = {},
) {
  const slots = {
    mode: 'request',
    rideType: 'location',
    destination,
    pickupDate,
    pickupTime,
  };

  let transportInfo = await resolveTransportInfoForRide(userId, null, null);
  if (!transportInfo) {
    return {
      domain: 'ride',
      step: STEPS.TRANSPORT_NAME,
      slots: { ...slots, afterSetup: 'location' },
      promptId: STEPS.TRANSPORT_NAME,
    };
  }
  slots.transportInfo = transportInfo;

  // Tira runs on the rider's own phone: the rider number is optional.
  const riderPhone = await getRiderPhoneForUser(userId);
  slots.riderPhone = riderPhone;

  if (!slots.destination) {
    return {
      domain: 'ride',
      step: STEPS.DESTINATION,
      slots,
      promptId: STEPS.DESTINATION,
    };
  }
  if (!normalizePickupDate(slots.pickupDate)) {
    return {
      domain: 'ride',
      step: STEPS.PICKUP_DATE,
      slots,
      promptId: STEPS.PICKUP_DATE,
    };
  }
  slots.pickupDate = normalizePickupDate(slots.pickupDate);

  const normalized = normalizePickupTime(slots.pickupTime);
  if (!normalized) {
    return {
      domain: 'ride',
      step: STEPS.PICKUP_TIME,
      slots,
      promptId: STEPS.PICKUP_TIME,
    };
  }
  slots.pickupTime = normalized;
  return buildConfirmDialogue(slots);
}

async function buildConfirmDialogue(slots) {
  let confirmSpeech;
  if (slots.rideType === 'appointment') {
    confirmSpeech = formatAppointmentRideRequest(
      slots.appointment,
      slots.pickupTime,
      slots.transportInfo,
    );
  } else {
    confirmSpeech = formatLocationRideRequest(
      slots.destination,
      slots.pickupDate,
      slots.pickupTime,
      slots.transportInfo,
    );
  }

  let riderPhone = slots.riderPhone;
  if (!riderPhone && slots.appointment) {
    // rider phone should already be set; leave empty last-4 if missing
  }
  const lastFourSpeech = formatLastFourConfirmSpeech(
    riderPhone,
    slots.transportInfo,
  );

  return {
    domain: 'ride',
    step: STEPS.CONFIRM,
    slots: { ...slots, confirmSpeech, lastFourSpeech },
    promptId: STEPS.CONFIRM,
  };
}

async function resumeAfterSetup(userId, dialogue) {
  const after = dialogue.slots.afterSetup;
  if (after === 'appointment') {
    return prepareRideToAppointment(userId, {
      pickupTime: dialogue.slots.pickupTime,
      doctorName: dialogue.slots.doctorName,
      appointment: dialogue.slots.appointment || null,
    });
  }
  if (after === 'location') {
    return prepareRideToLocation(userId, {
      destination: dialogue.slots.destination,
      pickupDate: dialogue.slots.pickupDate,
      pickupTime: dialogue.slots.pickupTime,
    });
  }
  return {
    domain: null,
    step: null,
    slots: {},
    _terminal: {
      speak: 'Got it. You can now say, request a ride to my next appointment.',
      reprompt: prompts.OPEN_REPROMPT,
    },
  };
}

async function prepareAndMaybeFinishRide(handlerInput, dialogue) {
  const userId =
    handlerInput.requestEnvelope.context?.System?.user?.userId ||
    handlerInput.requestEnvelope.session?.user?.userId;

  if (dialogue._terminal) {
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: dialogue._terminal,
    };
  }

  if (dialogue.step === 'ready_save_transport') {
    const name = dialogue.slots.transportName || 'My Ride';
    const phone = dialogue.slots.transportPhone || null;
    try {
      const transport = await setTransportInfo(userId, name, phone);
      const setupNote = transport.transportPhone
        ? ''
        : ' The phone number still needs to be configured before I can place calls.';
      if (dialogue.slots.afterSetup) {
        dialogue.slots.transportInfo = transport;
        const next = await resumeAfterSetup(userId, dialogue);
        if (next._terminal) {
          return {
            dialogue: { domain: null, step: null, slots: {} },
            done: true,
            prompt: {
              speak: `Got it. I saved ${transport.transportName} as your ride contact.${setupNote} ${next._terminal.speak}`,
              reprompt: next._terminal.reprompt,
            },
          };
        }
        return {
          dialogue: next,
          done: false,
          prompt: {
            speak: `Got it. I saved ${transport.transportName} as your ride contact.${setupNote} ${promptForRideStep(next).speak}`,
            reprompt: promptForRideStep(next).reprompt,
          },
        };
      }
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak: `Got it. I saved ${transport.transportName} as your ride contact.${setupNote} What else can I help you with?`,
          reprompt: prompts.OPEN_REPROMPT,
        },
      };
    } catch (e) {
      safeLog.error('ride_save_transport_failed', {
        errorMessage: e?.message,
        errorName: e?.name,
      });
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak: 'Sorry, I had trouble saving your transportation information.',
          reprompt: prompts.OPEN_REPROMPT,
        },
      };
    }
  }

  if (dialogue.step === 'ready_save_rider') {
    try {
      await setRiderPhone(userId, dialogue.slots.riderPhone);
      if (dialogue.slots.afterSetup) {
        const next = await resumeAfterSetup(userId, dialogue);
        if (next._terminal) {
          return {
            dialogue: { domain: null, step: null, slots: {} },
            done: true,
            prompt: {
              speak: `Got it. I saved your phone number for ride calls. ${next._terminal.speak}`,
              reprompt: next._terminal.reprompt,
            },
          };
        }
        return {
          dialogue: next,
          done: false,
          prompt: {
            speak: `Got it. I saved your phone number for ride calls. ${promptForRideStep(next).speak}`,
            reprompt: promptForRideStep(next).reprompt,
          },
        };
      }
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak:
            'Got it. I saved your phone number for ride calls. What else can I help you with?',
          reprompt: prompts.OPEN_REPROMPT,
        },
      };
    } catch (e) {
      safeLog.error('ride_save_rider_phone_failed', {
        errorMessage: e?.message,
        errorName: e?.name,
      });
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak: 'Sorry, I had trouble saving your phone number.',
          reprompt: prompts.OPEN_REPROMPT,
        },
      };
    }
  }

  return {
    dialogue,
    done: false,
    prompt: promptForRideStep(dialogue),
  };
}

async function applyRideAnswer(handlerInput, utterance) {
  const session = handlerInput.attributesManager.getSessionAttributes();
  const { getDialogue } = require('./state');
  const current = getDialogue(session);
  const dialogue = {
    domain: current.domain,
    step: current.step,
    slots: { ...(current.slots || {}) },
    promptId: current.promptId,
  };
  const userId =
    handlerInput.requestEnvelope.context?.System?.user?.userId ||
    handlerInput.requestEnvelope.session?.user?.userId;
  const text = normalizeUtterance(utterance);

  if (dialogue.step === STEPS.TRANSPORT_NAME) {
    if (!text) {
      return { dialogue, done: false, prompt: promptForRideStep(dialogue) };
    }
    dialogue.slots.transportName = text
      .replace(/^(?:my transport(?: service)? is|use|save)\s+/i, '')
      .trim();
    const phone = extractPhone(utterance);
    if (phone) dialogue.slots.transportPhone = phone;
    if (dialogue.slots.transportPhone || /\bskip\b/i.test(text)) {
      dialogue.step = 'ready_save_transport';
      return prepareAndMaybeFinishRide(handlerInput, dialogue);
    }
    dialogue.step = STEPS.TRANSPORT_PHONE;
    dialogue.promptId = dialogue.step;
    return { dialogue, done: false, prompt: promptForRideStep(dialogue) };
  }

  if (dialogue.step === STEPS.TRANSPORT_PHONE) {
    if (/\bskip\b/i.test(text)) {
      dialogue.slots.transportPhone = null;
    } else {
      const phone = extractPhone(utterance);
      if (!phone) {
        return {
          dialogue,
          done: false,
          prompt: {
            speak:
              "I didn't catch a phone number. Please say the digits, or say skip.",
            reprompt: 'Say the transport phone number, or say skip.',
          },
        };
      }
      dialogue.slots.transportPhone = phone;
    }
    dialogue.step = 'ready_save_transport';
    return prepareAndMaybeFinishRide(handlerInput, dialogue);
  }

  if (dialogue.step === STEPS.RIDER_PHONE) {
    const phone = extractPhone(utterance);
    if (!phone) {
      return {
        dialogue,
        done: false,
        prompt: {
          speak: "I didn't catch a phone number. Please say your phone number.",
          reprompt: 'Please say your phone number.',
        },
      };
    }
    dialogue.slots.riderPhone = phone;
    dialogue.step = 'ready_save_rider';
    return prepareAndMaybeFinishRide(handlerInput, dialogue);
  }

  if (dialogue.step === STEPS.DESTINATION) {
    if (!text) {
      return { dialogue, done: false, prompt: promptForRideStep(dialogue) };
    }
    dialogue.slots.destination = text;
    delete dialogue.slots.noUpcomingPreface;
    dialogue.step = STEPS.PICKUP_DATE;
    dialogue.promptId = dialogue.step;
    return { dialogue, done: false, prompt: promptForRideStep(dialogue) };
  }

  if (dialogue.step === STEPS.PICKUP_DATE) {
    const date = normalizePickupDate(utterance);
    if (!date) {
      return {
        dialogue,
        done: false,
        prompt: {
          speak: "I didn't catch the date. Please say a day, like tomorrow.",
          reprompt: 'Please say a pickup date.',
        },
      };
    }
    dialogue.slots.pickupDate = date;
    dialogue.step = STEPS.PICKUP_TIME;
    dialogue.promptId = dialogue.step;
    return { dialogue, done: false, prompt: promptForRideStep(dialogue) };
  }

  if (dialogue.step === STEPS.PICKUP_TIME) {
    const ambiguous = getAmbiguousPickupTime(utterance);
    if (ambiguous) {
      dialogue.slots.ambiguousTime = ambiguous;
      dialogue.step = STEPS.AMBIGUOUS_TIME;
      dialogue.promptId = dialogue.step;
      return { dialogue, done: false, prompt: promptForRideStep(dialogue) };
    }
    const time = normalizePickupTime(utterance);
    if (!time) {
      return {
        dialogue,
        done: false,
        prompt: {
          speak: "I didn't catch the time. Please say a time, like two P.M.",
          reprompt: 'Please say a pickup time.',
        },
      };
    }
    dialogue.slots.pickupTime = time;
    const status = pickupDateTimeStatus(
      dialogue.slots.pickupDate ||
        (dialogue.slots.appointment
          ? dialogue.slots.appointment.dateTime.slice(0, 10)
          : null),
      time,
      handlerInput.requestEnvelope.request.timestamp,
    );
    if (status.reason === 'PAST_TIME' || status.reason === 'PAST_DATE') {
      return {
        dialogue,
        done: false,
        prompt: {
          speak:
            status.reason === 'PAST_DATE'
              ? 'That pickup date has already passed. What date do you need the ride?'
              : 'That pickup time has already passed. What time would you like to be picked up?',
          reprompt: 'Please say a future pickup time.',
        },
      };
    }
    if (!dialogue.slots.riderPhone) {
      dialogue.slots.riderPhone = await getRiderPhoneForUser(userId);
    }
    const confirm = await buildConfirmDialogue(dialogue.slots);
    return {
      dialogue: confirm,
      done: false,
      prompt: promptForRideStep(confirm),
    };
  }

  if (dialogue.step === STEPS.AMBIGUOUS_TIME) {
    const resolved = resolveAmbiguousPickupTime(
      utterance,
      dialogue.slots.ambiguousTime,
    );
    if (!resolved) {
      return { dialogue, done: false, prompt: promptForRideStep(dialogue) };
    }
    dialogue.slots.pickupTime = resolved;
    delete dialogue.slots.ambiguousTime;
    if (!dialogue.slots.riderPhone) {
      dialogue.slots.riderPhone = await getRiderPhoneForUser(userId);
    }
    const confirm = await buildConfirmDialogue(dialogue.slots);
    return {
      dialogue: confirm,
      done: false,
      prompt: promptForRideStep(confirm),
    };
  }

  if (dialogue.step === STEPS.CHOICE) {
    let match = matchDeleteCandidate(dialogue.slots.candidates || [], utterance);
    if (!match) {
      const needle = normalizeUtterance(utterance)
        .toLowerCase()
        .replace(/^(dr\.?|doctor)\s+/i, '')
        .trim();
      const byDoctor = (dialogue.slots.candidates || []).filter((c) =>
        String(c.doctorName || '')
          .toLowerCase()
          .includes(needle),
      );
      if (byDoctor.length === 1) match = byDoctor[0];
    }
    if (!match) {
      return {
        dialogue,
        done: false,
        prompt: {
          speak: `I didn't catch which appointment. ${promptForRideStep(dialogue).speak}`,
          reprompt: promptForRideStep(dialogue).reprompt,
        },
      };
    }
    const full = await getAppointmentById(userId, match.appointmentId);
    if (!full) {
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak:
            'I could not find that appointment anymore. What else can I help you with?',
          reprompt: prompts.OPEN_REPROMPT,
        },
      };
    }
    dialogue.slots.appointment = slimRideAppointment(full);
    delete dialogue.slots.candidates;
    const normalized = normalizePickupTime(dialogue.slots.pickupTime);
    if (!normalized) {
      dialogue.step = STEPS.PICKUP_TIME;
      dialogue.promptId = dialogue.step;
      return { dialogue, done: false, prompt: promptForRideStep(dialogue) };
    }
    dialogue.slots.pickupTime = normalized;
    const confirm = await buildConfirmDialogue(dialogue.slots);
    return {
      dialogue: confirm,
      done: false,
      prompt: promptForRideStep(confirm),
    };
  }

  if (dialogue.step === STEPS.CONFIRM) {
    if (isNo(utterance)) {
      const transportText = formatTransportForSpeech(dialogue.slots.transportInfo);
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak: `No problem. I will not call ${transportText}. How else can I help you?`,
          reprompt: prompts.OPEN_REPROMPT,
        },
      };
    }
    if (!isYes(utterance)) {
      return { dialogue, done: false, prompt: promptForRideStep(dialogue) };
    }

    try {
      const pending = dialogue.slots;
      if (shouldAttemptRealTwilioHttp()) {
        await sendProgress(
          handlerInput,
          'One moment. Connecting your ride call.',
        );
      }
      let appointmentForCall = pending.appointment;
      if (pending.rideType === 'appointment' && pending.appointment?.appointmentId) {
        const fresh = await getAppointmentById(
          userId,
          pending.appointment.appointmentId,
        );
        if (fresh) appointmentForCall = slimRideAppointment(fresh);
      }
      const callResult =
        pending.rideType === 'appointment'
          ? await callTransportForAppointment({
              userId,
              transportInfo: pending.transportInfo,
              appointment: appointmentForCall,
              pickupTime: pending.pickupTime,
            })
          : await callTransportForLocation({
              userId,
              transportInfo: pending.transportInfo,
              destination: pending.destination,
              pickupDate: pending.pickupDate,
              pickupTime: pending.pickupTime,
            });

      const transportText = formatTransportForSpeech(pending.transportInfo);
      if (!callResult.placed) {
        let reasonText;
        let nextHint = '';
        if (callResult.reason === 'DESTINATION_PHONE_NOT_CONFIGURED') {
          reasonText = ` I do not have a phone number for ${transportText} yet.`;
          nextHint =
            ` Say: my transport is ${pending.transportInfo?.transportName || 'your service'}, then tell me their phone number.`;
        } else if (callResult.reason === 'RIDER_PHONE_NOT_CONFIGURED') {
          reasonText =
            ' I need the phone number I should call for you before I can connect the call.';
          nextHint = ' Say: my phone number is, then give your digits.';
        } else {
          reasonText = ' This device could not open the phone dialer.';
          nextHint = ' Please try again later, or say help.';
        }
        return {
          dialogue: { domain: null, step: null, slots: {} },
          done: true,
          prompt: {
            speak: `I prepared the ride request, but I could not connect the call yet.${reasonText}${nextHint} What else can I help you with?`,
            reprompt: prompts.OPEN_REPROMPT,
          },
        };
      }
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak: `Calling ${transportText} now. ${callResult.message || ''}`.trim(),
          reprompt: prompts.OPEN_REPROMPT,
        },
      };
    } catch (e) {
      safeLog.error('ride_call_failed', {
        errorMessage: e?.message,
        errorName: e?.name,
      });
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak: 'Sorry, I had trouble placing the call. What else can I help you with?',
          reprompt: prompts.OPEN_REPROMPT,
        },
      };
    }
  }

  return { dialogue, done: false, prompt: promptForRideStep(dialogue) };
}

module.exports = {
  STEPS,
  startSetTransport,
  startSetRiderPhone,
  prepareRideToAppointment,
  prepareRideToLocation,
  promptForRideStep,
  prepareAndMaybeFinishRide,
  applyRideAnswer,
};
