'use strict';
/* Mapowanie KeyboardEvent.code (to, co zapisuje strona w ustawieniach „Naciśnij, by mówić”)
   na nazwy klawiszy z uiohook-napi (UiohookKey). Liczbowe kody bierzemy z samego uiohook-napi w chwili uruchomienia. */

const NAMED = {
  Space: 'Space', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', Escape: 'Escape', CapsLock: 'CapsLock',
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
  Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  Backquote: 'Backquote', Minus: 'Minus', Equal: 'Equal', BracketLeft: 'BracketLeft', BracketRight: 'BracketRight',
  Backslash: 'Backslash', Semicolon: 'Semicolon', Quote: 'Quote', Comma: 'Comma', Period: 'Period', Slash: 'Slash',
  ShiftLeft: 'Shift', ShiftRight: 'ShiftRight', ControlLeft: 'Ctrl', ControlRight: 'CtrlRight',
  AltLeft: 'Alt', AltRight: 'AltRight', MetaLeft: 'Meta', MetaRight: 'MetaRight',
  NumLock: 'NumLock', ScrollLock: 'ScrollLock', PrintScreen: 'PrintScreen',
  NumpadMultiply: 'NumpadMultiply', NumpadAdd: 'NumpadAdd', NumpadSubtract: 'NumpadSubtract',
  NumpadDecimal: 'NumpadDecimal', NumpadDivide: 'NumpadDivide', NumpadEnter: 'NumpadEnter',
};
/* Przyciski myszy: uiohook numeruje 1 lewy, 2 prawy, 3 środkowy, 4 wstecz, 5 dalej. */
const MOUSE = { Mouse3: 3, Mouse4: 4, Mouse5: 5 };

/** Zwraca nazwę klawisza z UiohookKey albo null, gdy nie umiemy go przechwycić globalnie. */
function codeToUiohookName(code) {
  if (typeof code !== 'string' || code.length > 32) return null;
  let m;
  if ((m = code.match(/^Key([A-Z])$/))) return m[1];
  if ((m = code.match(/^Digit([0-9])$/))) return m[1];
  if ((m = code.match(/^(F(?:[1-9]|1[0-9]|2[0-4]))$/))) return m[1];
  if ((m = code.match(/^Numpad([0-9])$/))) return 'Numpad' + m[1];
  return Object.prototype.hasOwnProperty.call(NAMED, code) ? NAMED[code] : null;
}

/**
 * Buduje dopasowanie dla wybranego klawisza: { kind: 'key', keycode } albo { kind: 'mouse', button } albo null.
 * uiohookKeys to obiekt UiohookKey z uiohook-napi (nazwa → kod).
 */
function resolveBinding(code, uiohookKeys) {
  if (Object.prototype.hasOwnProperty.call(MOUSE, code)) return { kind: 'mouse', button: MOUSE[code] };
  const name = codeToUiohookName(code);
  if (!name || !uiohookKeys || typeof uiohookKeys[name] !== 'number') return null;
  return { kind: 'key', keycode: uiohookKeys[name] };
}

/** Czy zdarzenie z uiohook pasuje do skrótu. */
function matches(binding, ev, kind) {
  if (!binding || !ev) return false;
  if (binding.kind === 'key') return kind === 'key' && ev.keycode === binding.keycode;
  return kind === 'mouse' && ev.button === binding.button;
}

module.exports = { codeToUiohookName, resolveBinding, matches, NAMED, MOUSE };
