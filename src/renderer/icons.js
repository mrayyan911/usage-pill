'use strict';

/**
 * Glyph-based icons rather than embedded brand logos: cheap to render at
 * 14px, no image assets, and safely reproduces the "sparkle rotation" /
 * "jumping" feel the design calls for without copying trademarked marks.
 *
 * Both agent icons are 8x7 pixel sprites built as inline SVG rects (still
 * "no image assets" -- just markup) so they can be recolored via
 * currentColor and cheaply frame-swapped for a walk-cycle while a session
 * is running. Claude and Codex get distinct silhouettes (two ears/two eyes
 * vs. one antenna/one visor) so they read apart even at 16px, but share the
 * same grid, weight, and walk-cycle timing so they feel like one family.
 */
(function () {
  function pixelSprite(coralPixels, darkPixels) {
    const rects = coralPixels
      .map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="currentColor"/>`)
      .concat(
        darkPixels.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="#1b1b1d"/>`)
      )
      .join('');
    return `<svg viewBox="0 0 8 7" width="16" height="14" shape-rendering="crispEdges">${rects}</svg>`;
  }

  const FEET_BOTH = (l, r) => [l, r];
  const FEET_LEFT = (l) => [l];
  const FEET_RIGHT = (r) => [r];

  /** Simple 4-step walk cycle shared by every creature: L, both, R, both. */
  function walkCycle(body, dark, leftFoot, rightFoot) {
    const frame = (feet) => pixelSprite(body.concat(feet), dark);
    return {
      idle: frame(FEET_BOTH(leftFoot, rightFoot)),
      working: [
        frame(FEET_LEFT(leftFoot)),
        frame(FEET_BOTH(leftFoot, rightFoot)),
        frame(FEET_RIGHT(rightFoot)),
        frame(FEET_BOTH(leftFoot, rightFoot)),
      ],
    };
  }

  // Claude: ears, wide shoulders, two eyes, mouth, tapered belly.
  const CLAUDE_BODY = [
    [1, 0], [6, 0],
    [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1],
    [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2],
    [0, 3], [1, 3], [3, 3], [4, 3], [6, 3], [7, 3],
    [1, 4], [2, 4], [5, 4], [6, 4],
    [1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5],
  ];
  const CLAUDE_EYES_MOUTH = [[2, 3], [5, 3], [3, 4], [4, 4]];
  const claude = walkCycle(CLAUDE_BODY, CLAUDE_EYES_MOUTH, [1, 6], [6, 6]);

  // Codex: single antenna, rounder head, one horizontal visor -- a
  // deliberately different silhouette from Claude's two-eared creature.
  const CODEX_BODY = [
    [4, 0],
    [4, 1],
    [2, 2], [3, 2], [4, 2], [5, 2],
    [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3],
    [1, 4], [6, 4],
    [2, 5], [3, 5], [4, 5], [5, 5],
  ];
  const CODEX_VISOR = [[2, 4], [3, 4], [4, 4], [5, 4]];
  const codex = walkCycle(CODEX_BODY, CODEX_VISOR, [2, 6], [5, 6]);

  window.PILL_ICONS = {
    claude: {
      color: '#D97757',
      type: 'svg',
      idleGlyph: claude.idle,
      workingFrames: claude.working,
    },
    codex: {
      color: '#ECECEC',
      type: 'svg',
      idleGlyph: codex.idle,
      workingFrames: codex.working,
    },
    neutral: {
      color: '#7a7a7e',
      type: 'text',
      idleGlyph: '—',
      workingFrames: ['—'],
    },
  };
})();
