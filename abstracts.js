const ABSTRACT_PREVIEW_LINES = 4;
const ABSTRACT_COLLAPSED_SUFFIX = '...';
const ABSTRACT_TOGGLE_GAP = '    ';
const ABSTRACT_FILLER_SAFETY_PX = 1;

const abstractStates = new WeakMap();

function resolveLineHeight(reference) {
  return Number.parseFloat(window.getComputedStyle(reference).lineHeight);
}

function collectTextNodes(rootNode) {
  const textNodes = [];
  const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  return textNodes;
}

function trimNodeStart(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    node.nodeValue = node.nodeValue.replace(/^\s+/g, '');
    return node.nodeValue.length > 0;
  }

  while (node.firstChild) {
    if (trimNodeStart(node.firstChild)) {
      return true;
    }

    node.removeChild(node.firstChild);
  }

  return false;
}

function trimNodeEnd(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    node.nodeValue = node.nodeValue.replace(/\s+$/g, '');
    return node.nodeValue.length > 0;
  }

  while (node.lastChild) {
    if (trimNodeEnd(node.lastChild)) {
      return true;
    }

    node.removeChild(node.lastChild);
  }

  return false;
}

function normalizeAbstractSource(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();

  collectTextNodes(template.content).forEach((node) => {
    node.nodeValue = node.nodeValue.replace(/\s+/g, ' ');
  });

  trimNodeStart(template.content);
  trimNodeEnd(template.content);

  return Array.from(template.content.childNodes).map((node) => node.cloneNode(true));
}

function getNodesTextLength(nodes) {
  return nodes.reduce((length, node) => length + node.textContent.length, 0);
}

function getNodesText(nodes) {
  return nodes.map((node) => node.textContent).join('');
}

function cloneNodeTextRange(node, cursor, start, end) {
  if (cursor.offset >= end) {
    return null;
  }

  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.nodeValue;
    const nodeStart = cursor.offset;
    const nodeEnd = nodeStart + value.length;
    cursor.offset = nodeEnd;

    const sliceStart = Math.max(start - nodeStart, 0);
    const sliceEnd = Math.min(end - nodeStart, value.length);
    if (sliceStart >= sliceEnd) {
      return null;
    }

    return document.createTextNode(value.slice(sliceStart, sliceEnd));
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const clone = node.cloneNode(false);
  Array.from(node.childNodes).forEach((child) => {
    const childClone = cloneNodeTextRange(child, cursor, start, end);
    if (childClone) {
      clone.appendChild(childClone);
    }
  });

  return clone.childNodes.length ? clone : null;
}

function cloneAbstractRange(state, start, end, { trimStart = false, trimEnd = false } = {}) {
  const fragment = document.createDocumentFragment();
  const cursor = { offset: 0 };

  state.sourceNodes.forEach((node) => {
    const clone = cloneNodeTextRange(node, cursor, start, end);
    if (clone) {
      fragment.appendChild(clone);
    }
  });

  if (trimStart) {
    trimNodeStart(fragment);
  }

  if (trimEnd) {
    trimNodeEnd(fragment);
  }

  return fragment;
}

function trimEndOffset(state, offset) {
  let nextOffset = Math.min(offset, state.textLength);

  while (nextOffset > 0 && /\s/.test(state.plainText[nextOffset - 1])) {
    nextOffset -= 1;
  }

  return nextOffset;
}

function getAbstractMeasureCopy(state) {
  if (!state.measureCopy) {
    state.measureCopy = document.createElement('p');
    state.measureCopy.className = state.copy.className;
    state.measureCopy.classList.add('paper-abstract-measure');
    state.measureCopy.style.position = 'absolute';
    state.measureCopy.style.visibility = 'hidden';
    state.measureCopy.style.pointerEvents = 'none';
    state.measureCopy.style.zIndex = '-1';
    state.measureCopy.style.left = '-10000px';
    state.measureCopy.style.top = '0';
    state.measureCopy.style.margin = '0';
    state.measureCopy.style.contain = 'layout style';
    document.body.appendChild(state.measureCopy);
  }

  state.measureCopy.style.width = `${state.contentWidth}px`;
  return state.measureCopy;
}

function createAbstractTail(
  state,
  { suffixText, fillerWidth, toggleLabel, isExpanded, gapText = ABSTRACT_TOGGLE_GAP, isMeasure = false },
) {
  const tail = document.createElement('span');
  const suffix = document.createElement('span');
  const filler = document.createElement('span');
  const gap = document.createElement('span');
  const button = isMeasure ? state.button.cloneNode(false) : state.button;

  tail.className = 'abstract-tail';
  suffix.className = 'abstract-suffix';
  filler.className = 'abstract-filler';
  gap.className = 'abstract-gap';

  suffix.textContent = suffixText;
  filler.style.width = `${Math.max(fillerWidth, 0)}px`;
  gap.textContent = gapText;
  button.type = 'button';
  button.hidden = false;
  button.textContent = toggleLabel;
  button.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

  tail.appendChild(suffix);
  tail.appendChild(filler);
  tail.appendChild(gap);
  tail.appendChild(button);

  return tail;
}

function setMeasureContent(state, fragment, tailOptions = null) {
  const measureCopy = getAbstractMeasureCopy(state);
  measureCopy.replaceChildren(fragment);

  if (tailOptions) {
    measureCopy.appendChild(createAbstractTail(state, { ...tailOptions, isMeasure: true }));
  }

  return measureCopy;
}

function getInlineLineMetrics(element, lineHeight) {
  const range = document.createRange();
  range.selectNodeContents(element);

  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0.25 && rect.height > 0.25,
  );
  range.detach();

  const lines = [];
  const tolerance = lineHeight * 0.45;

  rects
    .sort((a, b) => a.top - b.top || a.left - b.left)
    .forEach((rect) => {
      const center = (rect.top + rect.bottom) / 2;
      const line = lines.find(
        (candidate) =>
          Math.abs(candidate.center - center) <= tolerance ||
          (rect.top < candidate.bottom - 1 && rect.bottom > candidate.top + 1),
      );

      if (!line) {
        lines.push({
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
          center,
        });
        return;
      }

      line.top = Math.min(line.top, rect.top);
      line.right = Math.max(line.right, rect.right);
      line.bottom = Math.max(line.bottom, rect.bottom);
      line.left = Math.min(line.left, rect.left);
      line.center = (line.top + line.bottom) / 2;
    });

  return lines.sort((a, b) => a.top - b.top);
}

function countMeasuredLines(state, start, end, tailOptions = null) {
  const fragment = cloneAbstractRange(state, start, end, {
    trimStart: start > 0,
    trimEnd: true,
  });
  const measureCopy = setMeasureContent(state, fragment, tailOptions);
  return getInlineLineMetrics(measureCopy, state.lineHeight).length;
}

function fitsCollapsedEnd(state, endOffset) {
  return (
    countMeasuredLines(state, 0, endOffset, {
      suffixText: ABSTRACT_COLLAPSED_SUFFIX,
      fillerWidth: 0,
      toggleLabel: 'Show more',
      isExpanded: false,
    }) <= ABSTRACT_PREVIEW_LINES
  );
}

function findCollapsedEndOffset(state) {
  let low = 0;
  let high = state.textLength;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);

    if (fitsCollapsedEnd(state, middle)) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return trimEndOffset(state, low);
}

function measureLineEndWidth(state, start, end, suffixText) {
  const fragment = cloneAbstractRange(state, start, end, {
    trimStart: start > 0,
    trimEnd: true,
  });
  const measureCopy = setMeasureContent(state, fragment);

  if (suffixText) {
    const suffix = document.createElement('span');
    suffix.className = 'abstract-suffix';
    suffix.textContent = suffixText;
    measureCopy.appendChild(suffix);
  }

  const lines = getInlineLineMetrics(measureCopy, state.lineHeight);
  const lastLine = lines[lines.length - 1];
  return Math.max(lastLine.right - measureCopy.getBoundingClientRect().left, 0);
}

function measureTailControlWidth(state, toggleLabel, isExpanded) {
  const measureCopy = setMeasureContent(
    state,
    document.createDocumentFragment(),
    {
      suffixText: '',
      fillerWidth: 0,
      toggleLabel,
      isExpanded,
    },
  );

  return measureCopy.querySelector('.abstract-tail').getBoundingClientRect().width;
}

function calculateFillerWidth(state, start, end, suffixText, toggleLabel, isExpanded) {
  const lineEndWidth = measureLineEndWidth(state, start, end, suffixText);
  const tailControlWidth = measureTailControlWidth(state, toggleLabel, isExpanded);

  return Math.max(
    Math.floor(state.contentWidth - lineEndWidth - tailControlWidth - ABSTRACT_FILLER_SAFETY_PX),
    0,
  );
}

function getNaturalTailLayout(state, toggleLabel, isExpanded) {
  const lineEndWidth = measureLineEndWidth(state, 0, state.textLength, '');
  const tailControlWidth = measureTailControlWidth(state, toggleLabel, isExpanded);
  const remainingWidth = state.contentWidth - lineEndWidth - tailControlWidth;

  return {
    fillerWidth: Math.max(Math.floor(remainingWidth - ABSTRACT_FILLER_SAFETY_PX), 0),
    fitsInLine: remainingWidth >= 0,
  };
}

function renderFullAbstract(state) {
  state.copy.replaceChildren(cloneAbstractRange(state, 0, state.textLength));
}

function renderCollapsedAbstract(state) {
  const content = cloneAbstractRange(state, 0, state.collapsedEndOffset, { trimEnd: true });
  state.copy.replaceChildren(content);
  state.copy.appendChild(
    createAbstractTail(state, {
      suffixText: ABSTRACT_COLLAPSED_SUFFIX,
      fillerWidth: state.collapsedFillerWidth,
      toggleLabel: 'Show more',
      isExpanded: false,
    }),
  );
}

function renderExpandedAbstract(state) {
  renderFullAbstract(state);
  state.copy.appendChild(
    createAbstractTail(state, {
      suffixText: '',
      fillerWidth: state.expandedFillerWidth,
      gapText: state.expandedTailFitsInLine ? ABSTRACT_TOGGLE_GAP : ' ',
      toggleLabel: 'Show less',
      isExpanded: true,
    }),
  );
}

function renderAbstract(container) {
  const state = abstractStates.get(container);

  container.classList.toggle('is-collapsible', state.isTruncatable);
  container.classList.toggle('is-expanded', state.isTruncatable && state.expanded);

  if (!state.isTruncatable) {
    renderFullAbstract(state);
    state.button.textContent = 'Show more';
    state.button.hidden = true;
    state.button.setAttribute('aria-expanded', 'false');
    return;
  }

  (state.expanded ? renderExpandedAbstract : renderCollapsedAbstract)(state);
}

function updateAbstractLayout(container) {
  const state = abstractStates.get(container);
  if (!container.clientWidth) {
    return;
  }

  state.lineHeight = resolveLineHeight(state.copy);
  state.contentWidth = state.copy.getBoundingClientRect().width;
  state.isTruncatable =
    countMeasuredLines(state, 0, state.textLength) > ABSTRACT_PREVIEW_LINES;

  if (!state.isTruncatable) {
    state.expanded = false;
    state.collapsedEndOffset = state.textLength;
    state.collapsedFillerWidth = 0;
    state.expandedFillerWidth = 0;
    state.expandedTailFitsInLine = false;
  } else {
    state.collapsedEndOffset = findCollapsedEndOffset(state);
    state.collapsedFillerWidth = calculateFillerWidth(
      state,
      0,
      state.collapsedEndOffset,
      ABSTRACT_COLLAPSED_SUFFIX,
      'Show more',
      false,
    );
    const expandedTailLayout = getNaturalTailLayout(state, 'Show less', true);
    state.expandedFillerWidth = expandedTailLayout.fillerWidth;
    state.expandedTailFitsInLine = expandedTailLayout.fitsInLine;
  }

  renderAbstract(container);
}

export function bindAbstracts() {
  const abstracts = Array.from(document.querySelectorAll('[data-abstract]'));

  // Truncation only depends on the column width.
  const resizeObserver = new ResizeObserver((entries) => {
    entries.forEach((entry) => {
      const container = entry.target.closest('[data-abstract]');
      const state = abstractStates.get(container);
      const width = entry.contentBoxSize[0].inlineSize;
      if (width === state.observedWidth) return;
      state.observedWidth = width;
      updateAbstractLayout(container);
    });
  });

  abstracts.forEach((container) => {
    const copy = container.querySelector('.paper-abstract-copy');
    const button = container.querySelector('.abstract-toggle');

    const sourceNodes = normalizeAbstractSource(copy.innerHTML);
    const textLength = getNodesTextLength(sourceNodes);
    const plainText = getNodesText(sourceNodes);

    button.hidden = true;
    button.remove();
    abstractStates.set(container, {
      copy,
      button,
      sourceNodes,
      textLength,
      plainText,
      observedWidth: -1,
      contentWidth: 0,
      collapsedEndOffset: textLength,
      collapsedFillerWidth: 0,
      expandedFillerWidth: 0,
      expandedTailFitsInLine: false,
      lineHeight: 0,
      measureCopy: null,
      expanded: false,
      isTruncatable: false,
    });

    button.addEventListener('click', () => {
      const state = abstractStates.get(container);
      if (!state.isTruncatable) return;
      state.expanded = !state.expanded;
      renderAbstract(container);
    });

    resizeObserver.observe(copy);
  });

  document.fonts.ready.then(() => abstracts.forEach((container) => updateAbstractLayout(container)));
}
