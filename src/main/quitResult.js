'use strict';

// Exit codes of `--quit`. `usage-pill upgrade` relaunches the monitor only
// when one was actually closed, and must not touch the install while a pill
// that ignored the request still holds its files open.
module.exports = { STOPPED: 0, NOT_RUNNING: 2, STILL_RUNNING: 3 };
