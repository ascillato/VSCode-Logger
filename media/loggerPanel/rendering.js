export function setButtonLabel(button, label) {
  if (!button || !label) {
    return;
  }
  button.title = label;
  button.setAttribute('aria-label', label);
  const hiddenText = button.querySelector('.sr-only');
  if (hiddenText) {
    hiddenText.textContent = label;
  }
}

export function updateToggleLabel(button, active) {
  if (!button || !button.dataset.label) {
    return;
  }
  const baseLabel = button.dataset.label;
  const label = `${baseLabel} (${active ? 'on' : 'off'})`;
  setButtonLabel(button, label);
}

export function setToggleState(button, active) {
  if (!button) {
    return;
  }
  button.dataset.active = active ? 'true' : 'false';
  button.setAttribute('aria-pressed', String(active));
  button.classList.toggle('toggle-button--active', active);
  updateToggleLabel(button, active);
}

export function isToggleActive(button) {
  return button?.dataset.active === 'true';
}

export function buildHighlightedContent(line, highlights) {
  const fragment = document.createDocumentFragment();

  if (line.length === 0) {
    fragment.appendChild(document.createTextNode('\u00A0'));
    return fragment;
  }

  if (!highlights?.length) {
    fragment.appendChild(document.createTextNode(line));
    return fragment;
  }

  const lowerLine = line.toLowerCase();
  let cursor = 0;

  const sortedHighlights = highlights
    .slice()
    .sort((a, b) => a.normalizedKey.length - b.normalizedKey.length);

  while (cursor < line.length) {
    let nextMatch = null;
    let nextIndex = line.length;
    let nextLength = 0;

    for (const highlight of sortedHighlights) {
      const search = highlight.normalizedKey;
      if (!search) {
        continue;
      }
      const idx = lowerLine.indexOf(search, cursor);
      if (idx !== -1 && idx < nextIndex) {
        nextIndex = idx;
        nextLength = search.length;
        nextMatch = highlight;
      }
    }

    if (!nextMatch || nextIndex === -1) {
      fragment.appendChild(document.createTextNode(line.slice(cursor)));
      break;
    }

    if (nextIndex > cursor) {
      fragment.appendChild(document.createTextNode(line.slice(cursor, nextIndex)));
    }

    const span = document.createElement('span');
    span.textContent = line.slice(nextIndex, nextIndex + nextLength);
    span.className = `highlighted-text ${nextMatch.className || ''}`.trim();
    if (nextMatch.color) {
      span.style.color = nextMatch.color;
      span.style.borderColor = nextMatch.color;
    }
    if (nextMatch.backgroundColor) {
      span.style.backgroundColor = nextMatch.backgroundColor;
    }
    fragment.appendChild(span);

    cursor = nextIndex + nextLength;
  }

  return fragment;
}
