/***************************************************************
 * DateStatus.gs — REQUEST TECH + FINAL CHECK DATE ENGINE V15
 * =============================================================
 * FILE RIÊNG. Không khai báo onOpen() / onEdit().
 * Không đè SEO / Brand / code khác.
 *
 * INPUT headers:
 *   Request TECH -> NGÀY RQ
 *   Final Check  -> Checked time
 *
 * RULE:
 * - Status có từ DONE:
 *     date trống -> điền NOW
 *     date có    -> giữ nguyên
 * - Status không DONE / bị xóa:
 *     clear date tương ứng
 *
 * KIẾN TRÚC V15:
 * - Menu chỉ QUEUE job rồi thoát nhanh.
 * - Worker recurring 1 phút CHỈ tồn tại khi có job/pending.
 * - Hết việc => worker trigger tự xóa để không chạy 24/7.
 * - Worker xử lý 1 batch bằng bulk read/write.
 * - Cursor chỉ tiến sau batch thành công.
 * - Hard-timeout => recurring worker còn sống và resume từ cursor cũ.
 * - Job non-terminal không bị menu mới tự động ghi đè.
 *
 * CÀI 1 LẦN SAU KHI THAY CODE:
 *   Run installDateStatusEngine()
 ***************************************************************/

const DATE_STATUS_CFG = {
  SHEET_NAME: 'INPUT',
  HEADER_ROW: 1,
  START_ROW: 2,

  HEADERS: {
    RQ_STATUS: 'Request TECH',
    RQ_DATE: 'NGÀY RQ',
    CHECK_STATUS: 'Final Check',
    CHECK_DATE: 'Checked time'
  },

  RQ_FORMAT: 'dd/MM/yyyy',
  CHECK_FORMAT: 'dd/MM/yyyy HH:mm',

  // 1 worker tick xử lý tối đa số row này.
  // Bulk read/write nên 1000 row vẫn rất nhẹ so với loop API từng row.
  BATCH_SIZE: 100,

  // Edit/paste nhỏ xử lý ngay. Paste lớn queue vào worker.
  // Giữ nhỏ để onEdit không chiếm execution lâu.
  ON_EDIT_DIRECT_MAX_ROWS: 20,

  // Job active quá lâu mà không heartbeat thì coi là stale.
  STALE_JOB_MS: 15 * 60 * 1000,

  // Lease sống lâu hơn giới hạn execution thông thường.
  // Nếu worker bị hard-kill, lease tự hết hạn và tick sau sẽ recover.
  EXECUTION_LEASE_MS: 370000,
  LEASE_GUARD_WAIT_MS: 1000,

  // Sau nhiều hard-timeout liên tiếp tại cùng cursor thì dừng rõ lỗi,
  // tránh retry vô hạn mỗi phút.
  MAX_HARD_RECOVERIES_PER_CURSOR: 6,
  MIN_RECOVERY_BATCH_SIZE: 20,

  // Catchable/transient error cũng phải backoff, không retry mỗi phút vô hạn.
  MAX_TRANSIENT_RETRIES_PER_CURSOR: 8,
  RETRY_BASE_MS: 60000,
  RETRY_MAX_MS: 15 * 60 * 1000,

  // Giới hạn queue property. Khi vượt ngưỡng, collapse range theo mode
  // thay vì drop edit cũ.
  MAX_PENDING_ITEMS: 30,

  // Release lease được phép chờ lâu hơn acquire bình thường.
  LEASE_RELEASE_WAIT_MS: 5000,

  // Worker recurring cố định — không churn trigger.
  WORKER_HANDLER: 'dateStatusWorkerTick_',
  EDIT_HANDLER: 'dateStatusOnEdit_',
  OPEN_HANDLER: 'dateStatusOnOpen_',

  PREFIX: 'DATE_STATUS_V15_',
  JOB_KEY: 'JOB',
  LAST_ERROR_KEY: 'LAST_ERROR',
  SPREADSHEET_ID_KEY: 'SPREADSHEET_ID',
  PENDING_EDIT_KEY: 'PENDING_EDITS',
  EXECUTION_LEASE_KEY: 'EXECUTION_LEASE'
};


/* ============================================================
 * INSTALL / MIGRATION
 * ============================================================ */

function installDateStatusEngine() {
  const ss =
    SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    throw new Error(
      'Hãy mở Apps Script gắn với Google Sheet rồi chạy installDateStatusEngine().'
    );
  }

  /*
   * MIGRATION CRITICAL SECTION
   *
   * Giữ ScriptLock trong lúc:
   * - kiểm tra worker cũ còn sống không,
   * - xóa recurring worker cũ,
   * - cleanup state legacy.
   *
   * Worker cũ muốn lấy Date execution lease cũng phải đi qua ScriptLock,
   * nên không thể "lọt vào" giữa bước check và cleanup.
   */
  const guard =
    LockService.getScriptLock();

  if (!guard.tryLock(10000)) {
    ss.toast(
      'Date state đang bận. Chờ vài giây rồi chạy install lại.',
      'DATE Tools',
      8
    );

    return false;
  }

  try {
    const activeLease =
      dateStatusFindAnyActiveLease_();

    if (activeLease) {
      const waitSeconds =
        Math.max(
          1,
          Math.ceil(
            (
              Number(activeLease.expiresAt) -
              Date.now()
            ) /
            1000
          )
        );

      ss.toast(
        'Date worker cũ đang chạy/giữ lease. Chờ khoảng ' +
        waitSeconds +
        's rồi chạy install lại.',
        'DATE Tools',
        10
      );

      return false;
    }

    /*
     * Xóa worker TRƯỚC cleanup state.
     * Một trigger cũ chưa bắt đầu sẽ không còn cơ hội chạy sau migration.
     */
    dateStatusDeleteWorkerTriggers_();

    dateStatusCleanupLegacyTriggers_();
    dateStatusCleanupLegacyState_();

    PropertiesService
      .getDocumentProperties()
      .setProperty(
        dateStatusKey_(
          DATE_STATUS_CFG.SPREADSHEET_ID_KEY
        ),
        ss.getId()
      );

  } finally {
    guard.releaseLock();
  }

  /*
   * Edit/Open trigger không phải worker nặng,
   * có thể ensure sau khi migration lock đã thả.
   */
  dateStatusEnsureSpreadsheetTrigger_(
    ss,
    DATE_STATUS_CFG.EDIT_HANDLER,
    'EDIT'
  );

  dateStatusEnsureSpreadsheetTrigger_(
    ss,
    DATE_STATUS_CFG.OPEN_HANDLER,
    'OPEN'
  );

  /*
   * Có thể có onEdit xảy ra đúng lúc install.
   * Reconcile thay vì delete worker mù:
   * - có pending/job => đảm bảo worker tồn tại
   * - không có việc => xóa worker
   */
  dateStatusReconcileWorkerForCurrentWork_();

  /*
   * KHÔNG gọi dateStatusOnOpen_() trực tiếp ở đây.
   *
   * installDateStatusEngine() thường được chạy từ Apps Script editor.
   * Context đó không có Spreadsheet UI nên SpreadsheetApp.getUi()
   * sẽ báo:
   * "Cannot call SpreadsheetApp.getUi() from this context."
   *
   * Open trigger đã được cài ở trên. Sau khi reload Google Sheet,
   * dateStatusOnOpen_() sẽ chạy trong đúng spreadsheet-open context
   * và tạo DATE Tools menu.
   */
  ss.toast(
    'Date engine V15 đã cài. Reload Sheet để hiện DATE Tools.',
    'DATE Tools',
    7
  );

  return true;
}

function dateStatusEnsureSpreadsheetTrigger_(
  ss,
  handler,
  type
) {
  const spreadsheetId =
    ss.getId();

  let matches =
    ScriptApp
      .getProjectTriggers()
      .filter(function(trigger) {
        return (
          trigger.getHandlerFunction() ===
            handler &&
          trigger.getTriggerSourceId() ===
            spreadsheetId
        );
      });

  if (!matches.length) {
    const builder =
      ScriptApp
        .newTrigger(handler)
        .forSpreadsheet(ss);

    if (type === 'OPEN') {
      builder.onOpen().create();
    } else {
      builder.onEdit().create();
    }

    /*
     * Re-fetch để xử lý race nếu 2 install execution cùng ensure.
     */
    matches =
      ScriptApp
        .getProjectTriggers()
        .filter(function(trigger) {
          return (
            trigger.getHandlerFunction() ===
              handler &&
            trigger.getTriggerSourceId() ===
              spreadsheetId
          );
        });
  }

  matches
    .slice(1)
    .forEach(function(trigger) {
      ScriptApp.deleteTrigger(
        trigger
      );
    });

  return matches.length > 0;
}

function dateStatusEnsureWorkerTrigger_() {
  const handler = DATE_STATUS_CFG.WORKER_HANDLER;

  let matches = ScriptApp
    .getProjectTriggers()
    .filter(function(trigger) {
      return trigger.getHandlerFunction() === handler;
    });

  if (!matches.length) {
    ScriptApp
      .newTrigger(handler)
      .timeBased()
      .everyMinutes(1)
      .create();

    /*
     * Re-fetch sau create.
     * Nếu 2 execution cùng create gần nhau, dọn duplicate ngay.
     */
    matches = ScriptApp
      .getProjectTriggers()
      .filter(function(trigger) {
        return trigger.getHandlerFunction() === handler;
      });
  }

  matches.slice(1).forEach(function(trigger) {
    ScriptApp.deleteTrigger(trigger);
  });

  return matches.length > 0;
}


function dateStatusDeleteWorkerTriggers_() {
  const handler = DATE_STATUS_CFG.WORKER_HANDLER;

  ScriptApp
    .getProjectTriggers()
    .forEach(function(trigger) {
      if (trigger.getHandlerFunction() === handler) {
        ScriptApp.deleteTrigger(trigger);
      }
    });
}


function dateStatusHasFallbackPendingLocked_() {
  const props = PropertiesService.getDocumentProperties();
  const prefix = dateStatusKey_('PENDING_FALLBACK_');
  const all = props.getProperties();

  return Object.keys(all).some(function(key) {
    return key.indexOf(prefix) === 0;
  });
}


function dateStatusMaybeStopWorker_() {
  const guard = LockService.getScriptLock();

  if (!guard.tryLock(DATE_STATUS_CFG.LEASE_RELEASE_WAIT_MS)) {
    return false;
  }

  try {
    const job = dateStatusLoadJob_();

    if (job && !dateStatusJobIsTerminal_(job.status)) {
      return false;
    }

    const pending = dateStatusLoadJson_(DATE_STATUS_CFG.PENDING_EDIT_KEY);

    if (Array.isArray(pending) && pending.length) {
      return false;
    }

    if (dateStatusHasFallbackPendingLocked_()) {
      return false;
    }

    dateStatusDeleteWorkerTriggers_();

    /*
     * Race guard:
     * fallback pending có thể được ghi không qua ScriptLock khi onEdit
     * thấy lock đang bận. Re-check SAU khi delete trigger.
     * Nếu work xuất hiện trong khe đó, tạo lại worker ngay.
     */
    const pendingAfter =
      dateStatusLoadJson_(DATE_STATUS_CFG.PENDING_EDIT_KEY);

    const fallbackAfter =
      dateStatusHasFallbackPendingLocked_();

    if (
      (Array.isArray(pendingAfter) && pendingAfter.length) ||
      fallbackAfter
    ) {
      dateStatusEnsureWorkerTriggerSafe_();
      return false;
    }

    return true;

  } finally {
    guard.releaseLock();
  }
}


function dateStatusReconcileWorkerForCurrentWork_() {
  const guard =
    LockService.getScriptLock();

  if (
    !guard.tryLock(
      DATE_STATUS_CFG.LEASE_RELEASE_WAIT_MS
    )
  ) {
    return false;
  }

  try {
    const job =
      dateStatusLoadJob_();

    const pending =
      dateStatusLoadJson_(
        DATE_STATUS_CFG.PENDING_EDIT_KEY
      );

    const hasFallback =
      dateStatusHasFallbackPendingLocked_();

    const hasWork =
      (
        job &&
        !dateStatusJobIsTerminal_(
          job.status
        )
      ) ||
      (
        Array.isArray(pending) &&
        pending.length > 0
      ) ||
      hasFallback;

    if (hasWork) {
      return dateStatusEnsureWorkerTriggerSafe_();
    }

    dateStatusDeleteWorkerTriggers_();
    return true;

  } finally {
    guard.releaseLock();
  }
}

function dateStatusCleanupLegacyTriggers_() {
  const legacyHandlers = [
    'dateStatusContinue_',
    'continueDateReload_',
    'continueSelectedDateUpdate_'
  ];

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (legacyHandlers.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}


function dateStatusFindAnyActiveLease_() {
  const props = PropertiesService.getDocumentProperties();
  const all = props.getProperties();
  const prefixes = [
    'DATE_STATUS_V1_',
    'DATE_STATUS_V2_',
    'DATE_STATUS_V3_',
    'DATE_STATUS_V4_',
    'DATE_STATUS_V5_',
    'DATE_STATUS_V6_',
    'DATE_STATUS_V7_',
    'DATE_STATUS_V8_',
    'DATE_STATUS_V9_',
    'DATE_STATUS_V10_',
    'DATE_STATUS_V11_',
    'DATE_STATUS_V12_',
    'DATE_STATUS_V13_',
    'DATE_STATUS_V14_'
  ];

  const now = Date.now();

  for (let i = 0; i < prefixes.length; i++) {
    const key = prefixes[i] + 'EXECUTION_LEASE';
    const raw = all[key];

    if (!raw) continue;

    try {
      const lease = JSON.parse(raw);

      if (
        lease &&
        lease.token &&
        Number(lease.expiresAt) > now
      ) {
        lease.key = key;
        return lease;
      }

      // Lease hết hạn => dọn luôn.
      props.deleteProperty(key);

    } catch (error) {
      // Lease hỏng => dọn.
      props.deleteProperty(key);
    }
  }

  return null;
}


function dateStatusCleanupLegacyState_() {
  const props = PropertiesService.getDocumentProperties();
  const all = props.getProperties();
  const legacyPrefixes = [
    'DATE_STATUS_V1_',
    'DATE_STATUS_V2_',
    'DATE_STATUS_V3_',
    'DATE_STATUS_V4_',
    'DATE_STATUS_V5_',
    'DATE_STATUS_V6_',
    'DATE_STATUS_V7_',
    'DATE_STATUS_V8_',
    'DATE_STATUS_V9_',
    'DATE_STATUS_V10_',
    'DATE_STATUS_V11_',
    'DATE_STATUS_V12_',
    'DATE_STATUS_V13_',
    'DATE_STATUS_V14_'
  ];

  Object.keys(all).forEach(function(key) {
    if (
      legacyPrefixes.some(function(prefix) {
        return key.indexOf(prefix) === 0;
      })
    ) {
      props.deleteProperty(key);
    }
  });
}


/* ============================================================
 * MENU RIÊNG
 * ============================================================ */

function dateStatusOnOpen_() {
  try {
    SpreadsheetApp
      .getUi()
      .createMenu('DATE Tools')
      .addItem(
        'Update selected: Request TECH + Checked time',
        'updateSelectedRequestTechCheckedTime'
      )
      .addItem(
        'Update selected: Request TECH only',
        'dateStatusUpdateSelectedRqOnly'
      )
      .addItem(
        'Update selected: Checked time only',
        'dateStatusUpdateSelectedCheckOnly'
      )
      .addSeparator()
      .addItem(
        'Reload all: Request TECH + Checked time',
        'reloadRequestTechCheckedTime'
      )
      .addItem(
        'Reload all: Request TECH only',
        'dateStatusReloadRqOnly'
      )
      .addItem(
        'Reload all: Checked time only',
        'dateStatusReloadCheckOnly'
      )
      .addSeparator()
      .addItem(
        'Processing status',
        'showDateStatusProcessingStatus'
      )
      .addItem(
        'Reset Date job/state',
        'resetDateStatusEngineState'
      )
      .addItem(
        'Reinstall Date triggers',
        'installDateStatusEngine'
      )
      .addToUi();

    /*
     * Nếu còn job/pending từ phiên trước nhưng worker trigger bị mất,
     * mở Sheet sẽ tự chữa.
     */
    dateStatusReconcileWorkerForCurrentWork_();

  } catch (error) {
    console.log('[DATE STATUS] Menu error: ' + error);
  }
}


/* ============================================================
 * INSTALLABLE ON EDIT
 * ============================================================ */

function dateStatusOnEdit_(e) {
  if (!e || !e.range) return;

  const sh = e.range.getSheet();

  if (!sh || sh.getName() !== DATE_STATUS_CFG.SHEET_NAME) {
    return;
  }

  const editEndRow = e.range.getLastRow();
  if (editEndRow < DATE_STATUS_CFG.START_ROW) return;

  const startRow = Math.max(
    DATE_STATUS_CFG.START_ROW,
    e.range.getRow()
  );

  const numRows = editEndRow - startRow + 1;
  if (numRows < 1) return;

  const spreadsheetId =
    (e.source || sh.getParent()).getId();

  /*
   * Header lookup cũng là Sheets API.
   * Nếu Google timeout ngay tại đây thì bản cũ mất edit vì chưa kịp queue.
   * V15: transient header error => queue cả 2 date rule cho đúng rows.
   * Đây là repair idempotent nên an toàn, chỉ xử lý thừa 1 rule.
   */
  let cols;

  try {
    cols = dateStatusGetColumns_(sh);

  } catch (error) {
    if (dateStatusIsTransientError_(error)) {
      dateStatusAddPendingEdit_({
        spreadsheetId: spreadsheetId,
        sheetId: sh.getSheetId(),
        startRow: startRow,
        endRow: editEndRow,
        processRq: true,
        processCheck: true
      });

      return;
    }

    throw error;
  }

  const editStartCol = e.range.getColumn();
  const editEndCol = e.range.getLastColumn();

  const processRq = dateStatusRangeTouchesColumn_(
    editStartCol,
    editEndCol,
    cols.RQ_STATUS
  );

  const processCheck = dateStatusRangeTouchesColumn_(
    editStartCol,
    editEndCol,
    cols.CHECK_STATUS
  );

  if (!processRq && !processCheck) return;

  const pendingItem = {
    spreadsheetId: spreadsheetId,
    sheetId: sh.getSheetId(),
    startRow: startRow,
    endRow: editEndRow,
    processRq: processRq,
    processCheck: processCheck
  };

  // Paste lớn luôn queue.
  if (numRows > DATE_STATUS_CFG.ON_EDIT_DIRECT_MAX_ROWS) {
    dateStatusAddPendingEdit_(pendingItem);
    return;
  }

  const leaseToken =
    dateStatusAcquireExecutionLease_('ON_EDIT');

  if (!leaseToken) {
    dateStatusAddPendingEdit_(pendingItem);
    return;
  }

  try {
    dateStatusProcessRange_(
      sh,
      startRow,
      numRows,
      cols,
      new Date(),
      {
        processRq: processRq,
        processCheck: processCheck
      }
    );

  } catch (error) {
    if (dateStatusIsTransientError_(error)) {
      dateStatusAddPendingEdit_(pendingItem);
      return;
    }

    throw error;

  } finally {
    dateStatusReleaseExecutionLease_(leaseToken);
  }
}

/* ============================================================
 * PUBLIC MENU HANDLERS
 * ============================================================ */

function updateSelectedRequestTechCheckedTime() {
  return dateStatusQueueSelected_(true, true, 'DATE SELECTED');
}

function dateStatusUpdateSelectedRqOnly() {
  return dateStatusQueueSelected_(true, false, 'REQUEST TECH SELECTED');
}

function dateStatusUpdateSelectedCheckOnly() {
  return dateStatusQueueSelected_(false, true, 'FINAL CHECK SELECTED');
}

function reloadRequestTechCheckedTime() {
  return dateStatusQueueReload_(true, true, 'DATE RELOAD');
}

function dateStatusReloadRqOnly() {
  return dateStatusQueueReload_(true, false, 'REQUEST TECH RELOAD');
}

function dateStatusReloadCheckOnly() {
  return dateStatusQueueReload_(false, true, 'FINAL CHECK RELOAD');
}


function dateStatusQueueSelected_(processRq, processCheck, title) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getActiveSheet();

  if (!sh || sh.getName() !== DATE_STATUS_CFG.SHEET_NAME) {
    ss.toast('Hãy chọn vùng trong sheet INPUT.', title, 5);
    return;
  }

  const rg = sh.getActiveRange();
  if (!rg) return;

  const startRow = Math.max(DATE_STATUS_CFG.START_ROW, rg.getRow());

  /*
   * Tránh trường hợp user chọn nguyên cột => queue tới hàng trăm nghìn row.
   * Chỉ cần xử lý tới global lastRow hiện tại của INPUT.
   */
  const endRow = Math.min(
    rg.getLastRow(),
    sh.getLastRow()
  );

  if (endRow < startRow) {
    ss.toast('Vùng chọn không có dòng dữ liệu.', title, 5);
    return;
  }

  const queued = dateStatusQueueJob_({
    mode: processRq && processCheck
      ? 'SELECTED'
      : (processRq ? 'SELECTED_RQ' : 'SELECTED_CHECK'),
    spreadsheetId: ss.getId(),
    sheetId: sh.getSheetId(),
    sheetName: sh.getName(),
    startRow: startRow,
    endRow: endRow,
    processRq: processRq,
    processCheck: processCheck
  });

  if (!queued.ok) {
    ss.toast(queued.message, title, 8);
    return;
  }

  ss.toast(
    'QUEUED + LOCKED rows ' + startRow + ':' + endRow +
    '. Click sang ô khác không ảnh hưởng. Worker sẽ xử lý nền.',
    title,
    7
  );
}


function dateStatusQueueReload_(processRq, processCheck, title) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(DATE_STATUS_CFG.SHEET_NAME);

  if (!sh) {
    throw new Error('Không tìm thấy sheet "' + DATE_STATUS_CFG.SHEET_NAME + '".');
  }

  /*
   * Menu KHÔNG đọc header / last row.
   * Chỉ queue state rồi thoát. Worker nền mới resolve last row.
   */
  const queued = dateStatusQueueJob_({
    mode: processRq && processCheck
      ? 'FULL_RELOAD'
      : (processRq ? 'FULL_RELOAD_RQ' : 'FULL_RELOAD_CHECK'),
    spreadsheetId: ss.getId(),
    sheetId: sh.getSheetId(),
    sheetName: sh.getName(),
    startRow: DATE_STATUS_CFG.START_ROW,
    endRow: 0,
    resolveEndRow: true,
    processRq: processRq,
    processCheck: processCheck
  });

  if (!queued.ok) {
    ss.toast(queued.message, title, 8);
    return;
  }

  ss.toast(
    'QUEUED reload từ row 2. Worker nền sẽ tự xác định dòng cuối.',
    title,
    7
  );
}


/* ============================================================
 * QUEUE JOB — MENU CHỈ SAVE STATE, KHÔNG XỬ LÝ BATCH
 * ============================================================ */

function dateStatusQueueJob_(input) {
  const guard = LockService.getScriptLock();

  if (!guard.tryLock(DATE_STATUS_CFG.LEASE_GUARD_WAIT_MS)) {
    return {
      ok: false,
      message: 'Date state đang bận. Thử lại sau vài giây.'
    };
  }

  let job;

  try {
    const existing = dateStatusLoadJob_();

    /*
     * V15: tuyệt đối không tự overwrite job non-terminal.
     * Nếu state thật sự kẹt, worker recovery hoặc Reset xử lý.
     */
    if (
      existing &&
      !dateStatusJobIsTerminal_(existing.status)
    ) {
      return {
        ok: false,
        message:
          'Date job đang chạy: ' + existing.mode +
          ' rows ' + existing.startRow + ':' +
          (existing.resolveEndRow ? 'RESOLVING' : existing.endRow) +
          ' | Next ' + existing.cursor +
          '. Xem Processing status hoặc Reset Date job/state.'
      };
    }

    const now = Date.now();

    // Job mới => LAST ERROR cũ không còn là lỗi của job hiện tại.
    PropertiesService
      .getDocumentProperties()
      .deleteProperty(
        dateStatusKey_(
          DATE_STATUS_CFG.LAST_ERROR_KEY
        )
      );

    job = {
      version: 14,
      token: Utilities.getUuid(),
      mode: input.mode,
      spreadsheetId: input.spreadsheetId,
      sheetId: Number(input.sheetId),
      sheetName: input.sheetName || DATE_STATUS_CFG.SHEET_NAME,
      startRow: Number(input.startRow),
      endRow: Number(input.endRow),
      resolveEndRow: input.resolveEndRow === true,
      cursor: Number(input.startRow),
      lastSuccessRow: Number(input.startRow) - 1,
      processRq: input.processRq === true,
      processCheck: input.processCheck === true,
      status: 'QUEUED',
      phase: 'QUEUED',
      startedAt: now,
      updatedAt: now,
      checkedRows: 0,
      rqFilled: 0,
      rqCleared: 0,
      checkedFilled: 0,
      checkedCleared: 0,
      unchanged: 0,
      hiddenSkipped: 0,
      hardRecoveryCount: 0,
      totalHardRecoveries: 0,
      transientRetryCount: 0,
      totalTransientRetries: 0,
      retryNotBefore: 0,
      recoveryBatchSize: DATE_STATUS_CFG.BATCH_SIZE,
      batchCursor: 0,
      batchNowMs: 0,
      errorPhase: '',
      errorRow: 0,
      errorMessage: ''
    };

    dateStatusSaveJob_(job);

    PropertiesService
      .getDocumentProperties()
      .setProperty(
        dateStatusKey_(DATE_STATUS_CFG.SPREADSHEET_ID_KEY),
        input.spreadsheetId
      );

  } finally {
    guard.releaseLock();
  }

  /*
   * Job chỉ được báo QUEUED nếu worker thật sự tồn tại.
   * Tránh case trigger quota/permission lỗi mà UI vẫn báo thành công.
   */
  if (!dateStatusEnsureWorkerTriggerSafe_()) {
    const guard2 = LockService.getScriptLock();

    if (guard2.tryLock(DATE_STATUS_CFG.LEASE_RELEASE_WAIT_MS)) {
      try {
        const current = dateStatusLoadJob_();

        if (current && current.token === job.token) {
          current.status = 'ERROR';
          current.phase = 'ERROR_WORKER_TRIGGER';
          current.updatedAt = Date.now();
          current.errorPhase = 'CREATE_WORKER_TRIGGER';
          current.errorRow = Number(current.cursor) || Number(current.startRow);
          current.errorMessage =
            'Không tạo được Date worker trigger. ' +
            'Có thể project đã chạm quota trigger hoặc thiếu quyền.';

          dateStatusSaveJob_(current);
          dateStatusSaveLastError_(
            current,
            new Error(current.errorMessage)
          );
        }
      } finally {
        guard2.releaseLock();
      }
    }

    return {
      ok: false,
      message:
        'Không tạo được Date worker trigger. ' +
        'Chạy installDateStatusEngine() hoặc kiểm tra quota trigger.'
    };
  }

  console.log(
    '[DATE STATUS QUEUED]' +
    ' mode=' + job.mode +
    ' | LOCKED_ROWS=' + job.startRow + ':' + job.endRow +
    ' | rq=' + job.processRq +
    ' | check=' + job.processCheck
  );

  return { ok: true, job: job };
}

/* ============================================================
 * RECURRING WORKER — 1 BATCH / TICK
 * ============================================================ */

function dateStatusWorkerTick_() {
  const leaseToken = dateStatusAcquireExecutionLease_('WORKER');

  if (!leaseToken) {
    return;
  }

  let job = null;
  let phase = 'PROMOTE_PENDING';
  let batchStart = DATE_STATUS_CFG.START_ROW;

  try {
    // Chỉ một worker được promote pending / chạy batch tại một thời điểm.
    dateStatusPromotePendingEditIfIdle_();

    job = dateStatusLoadJob_();

    if (!job || dateStatusJobIsTerminal_(job.status)) {
      return;
    }

    const nowMs = Date.now();

    if (
      Number(job.retryNotBefore || 0) > nowMs
    ) {
      // Backoff window chưa hết; tick này bỏ qua.
      return;
    }

    /*
     * Nếu tick trước chết cứng, state thường còn RUNNING tại cùng cursor.
     * Giảm batch dần để tự phục hồi thay vì retry 250 row mãi.
     */
    if (job.status === 'RUNNING') {
      job.hardRecoveryCount =
        (Number(job.hardRecoveryCount) || 0) + 1;

      job.totalHardRecoveries =
        (Number(job.totalHardRecoveries) || 0) + 1;

      job.retryNotBefore = 0;

      const previousBatch =
        Number(job.recoveryBatchSize) ||
        DATE_STATUS_CFG.BATCH_SIZE;

      job.recoveryBatchSize = Math.max(
        DATE_STATUS_CFG.MIN_RECOVERY_BATCH_SIZE,
        Math.floor(previousBatch / 2)
      );

      if (
        job.hardRecoveryCount >
        DATE_STATUS_CFG.MAX_HARD_RECOVERIES_PER_CURSOR
      ) {
        job.status = 'ERROR';
        job.phase = 'ERROR_REPEATED_HARD_TIMEOUT';
        job.updatedAt = Date.now();
        job.errorPhase = job.phase;
        job.errorRow = Number(job.cursor) || Number(job.startRow);
        job.errorMessage =
          'Worker bị hard-timeout lặp lại tại cùng cursor. ' +
          'Batch đã giảm tới ' + job.recoveryBatchSize + ' row.';

        dateStatusSaveJob_(job);
        dateStatusSaveLastError_(job, new Error(job.errorMessage));
        return;
      }
    }

    job.status = 'RUNNING';
    phase = 'OPEN_SPREADSHEET';
    job.phase = phase;
    job.updatedAt = Date.now();
    dateStatusSaveJob_(job);

    const ss = SpreadsheetApp.openById(job.spreadsheetId);
    const sh = ss.getSheetByName(DATE_STATUS_CFG.SHEET_NAME);

    if (!sh || sh.getSheetId() !== Number(job.sheetId)) {
      throw new Error(
        'Không tìm thấy đúng INPUT sheetId ' + job.sheetId + '.'
      );
    }

    phase = 'LOAD_HEADERS';
    job.phase = phase;
    job.updatedAt = Date.now();
    dateStatusSaveJob_(job);

    const cols = dateStatusGetColumns_(sh);

    if (job.resolveEndRow === true) {
      let resolvedLastRow = DATE_STATUS_CFG.START_ROW - 1;

      /*
       * Tính last row theo CẢ status + date.
       * Nhờ vậy full reload vẫn thấy các date mồ côi cần clear
       * dù status cuối cùng nằm ở phía trên.
       */
      if (job.processRq === true) {
        resolvedLastRow = Math.max(
          resolvedLastRow,
          dateStatusGetLastDataRowFast_(sh, cols.RQ_STATUS),
          dateStatusGetLastDataRowFast_(sh, cols.RQ_DATE)
        );
      }

      if (job.processCheck === true) {
        resolvedLastRow = Math.max(
          resolvedLastRow,
          dateStatusGetLastDataRowFast_(sh, cols.CHECK_STATUS),
          dateStatusGetLastDataRowFast_(sh, cols.CHECK_DATE)
        );
      }

      job.endRow = resolvedLastRow;
      job.resolveEndRow = false;
      job.updatedAt = Date.now();
      dateStatusSaveJob_(job);

      if (resolvedLastRow < DATE_STATUS_CFG.START_ROW) {
        job.status = 'DONE';
        job.phase = 'DONE_NO_STATUS_OR_DATE';
        job.cursor = DATE_STATUS_CFG.START_ROW;
        job.lastSuccessRow = DATE_STATUS_CFG.START_ROW - 1;
        job.updatedAt = Date.now();
        dateStatusSaveJob_(job);
        return;
      }
    }

    batchStart = Math.max(
      Number(job.cursor) || Number(job.startRow),
      Number(job.startRow)
    );

    console.log(
      '[DATE STATUS WORKER]' +
      ' mode=' + job.mode +
      ' | LOCKED_ROWS=' + job.startRow + ':' + job.endRow +
      ' | cursor=' + batchStart
    );

    if (batchStart > Number(job.endRow)) {
      dateStatusFinishJob_(job);
      return;
    }

    /*
     * Selection đã snapshot startRow/endRow khi bấm menu.
     * Không hỏi Filter/hidden state từng row.
     * Row nằm trong snapshot => xử lý.
     */
    const effectiveBatchSize = Math.max(
      DATE_STATUS_CFG.MIN_RECOVERY_BATCH_SIZE,
      Math.min(
        DATE_STATUS_CFG.BATCH_SIZE,
        Number(job.recoveryBatchSize) || DATE_STATUS_CFG.BATCH_SIZE
      )
    );

    const batchRows = Math.min(
      effectiveBatchSize,
      Number(job.endRow) - batchStart + 1
    );

    const batchEnd =
      batchStart +
      batchRows -
      1;

    /*
     * Cùng một cursor luôn dùng cùng timestamp qua các lần retry.
     * Nếu hard-timeout sau khi RQ đã fill nhưng trước Checked time,
     * lần retry không tạo timestamp mới cho phần còn lại.
     */
    if (
      Number(job.batchCursor || 0) !==
        batchStart ||
      !Number(job.batchNowMs || 0)
    ) {
      job.batchCursor =
        batchStart;

      job.batchNowMs =
        Date.now();
    }

    phase =
      'PROCESS_' +
      batchStart +
      '_TO_' +
      batchEnd;

    job.phase = phase;
    job.updatedAt = Date.now();

    // Persist timestamp BEFORE any write.
    dateStatusSaveJob_(job);

    const stats = dateStatusProcessRange_(
      sh,
      batchStart,
      batchRows,
      cols,
      new Date(
        Number(job.batchNowMs)
      ),
      {
        processRq: job.processRq === true,
        processCheck: job.processCheck === true
      }
    );

    // Token guard: job mới không được execution cũ ghi đè.
    const current = dateStatusLoadJob_();

    if (!current || current.token !== job.token) {
      console.log('[DATE STATUS] Token changed; skip old checkpoint.');
      return;
    }

    job.checkedRows += Number(stats.checkedRows || 0);
    job.rqFilled += Number(stats.rqFilled || 0);
    job.rqCleared += Number(stats.rqCleared || 0);
    job.checkedFilled += Number(stats.checkedFilled || 0);
    job.checkedCleared += Number(stats.checkedCleared || 0);
    job.unchanged += Number(stats.unchanged || 0);
    job.hiddenSkipped += Number(stats.hiddenSkipped || 0);

    job.lastSuccessRow = batchEnd;
    job.cursor = batchEnd + 1;
    job.updatedAt = Date.now();

    // Batch thành công => reset recovery state.
    job.hardRecoveryCount = 0;
    job.transientRetryCount = 0;
    job.retryNotBefore = 0;
    job.recoveryBatchSize = DATE_STATUS_CFG.BATCH_SIZE;
    job.batchCursor = 0;
    job.batchNowMs = 0;

    job.errorPhase = '';
    job.errorRow = 0;
    job.errorMessage = '';

    if (job.cursor > job.endRow) {
      dateStatusFinishJob_(job);
    } else {
      job.status = 'WAITING';
      job.phase = 'WAITING_NEXT_TICK';
      dateStatusSaveJob_(job);
    }

  } catch (error) {
    const current = dateStatusLoadJob_();

    if (job && current && current.token === job.token) {
      const transient = dateStatusIsTransientError_(error);

      job.updatedAt = Date.now();
      job.errorPhase = phase;
      job.errorRow = batchStart;
      job.errorMessage = dateStatusFormatError_(error);

      if (transient) {
        job.transientRetryCount =
          (Number(job.transientRetryCount) || 0) + 1;

        job.totalTransientRetries =
          (Number(job.totalTransientRetries) || 0) + 1;

        /*
         * Nếu lỗi xảy ra trong PROCESS batch, giảm batch luôn.
         * Catchable "Service Spreadsheets timed out" ở bản cũ
         * retry nguyên 250 row mãi nên có thể không thoát được.
         */
        if (String(phase).indexOf('PROCESS_') === 0) {
          job.recoveryBatchSize = Math.max(
            DATE_STATUS_CFG.MIN_RECOVERY_BATCH_SIZE,
            Math.floor(
              (Number(job.recoveryBatchSize) || DATE_STATUS_CFG.BATCH_SIZE) / 2
            )
          );
        }

        if (
          job.transientRetryCount >
          DATE_STATUS_CFG.MAX_TRANSIENT_RETRIES_PER_CURSOR
        ) {
          job.status = 'ERROR';
          job.phase = 'ERROR_REPEATED_TRANSIENT';
          job.errorMessage =
            'Transient error lặp lại quá nhiều lần tại cùng cursor. ' +
            job.errorMessage;
          job.retryNotBefore = 0;

        } else {
          const delay = Math.min(
            DATE_STATUS_CFG.RETRY_MAX_MS,
            DATE_STATUS_CFG.RETRY_BASE_MS *
              Math.pow(2, Math.max(0, job.transientRetryCount - 1))
          );

          job.status = 'WAITING_RETRY';
          job.phase = 'RETRY_AFTER_ERROR';
          job.retryNotBefore = Date.now() + delay;
        }

      } else {
        job.status = 'ERROR';
        job.phase = 'ERROR';
        job.retryNotBefore = 0;
      }

      dateStatusSaveJob_(job);
      dateStatusSaveLastError_(job, error);
    }

    console.error(
      '[DATE STATUS] ' + phase +
      ' | row ' + batchStart +
      ' | ' + dateStatusFormatError_(error)
    );

  } finally {
    dateStatusReleaseExecutionLease_(leaseToken);

    /*
     * V15: xong toàn bộ job/pending thì xóa worker recurring.
     * Function này re-check state dưới ScriptLock nên không xóa nhầm
     * worker vừa được một edit/menu mới tạo.
     */
    dateStatusMaybeStopWorker_();
  }
}

// Legacy handler name: nếu còn trigger cũ chưa xóa kịp thì chạy worker mới.
function dateStatusContinue_() {
  dateStatusWorkerTick_();
}


/* ============================================================
 * CORE BULK PROCESSOR
 * ============================================================ */

function dateStatusProcessRange_(
  sh,
  startRow,
  numRows,
  cols,
  now,
  options
) {
  options = options || {};

  const processRq = options.processRq === true;
  const processCheck = options.processCheck === true;

  const stats = {
    checkedRows: 0,
    rqFilled: 0,
    rqCleared: 0,
    checkedFilled: 0,
    checkedCleared: 0,
    unchanged: 0,
    hiddenSkipped: 0
  };

  if (
    numRows < 1 ||
    (!processRq && !processCheck)
  ) {
    return stats;
  }

  const relevantCols = [];

  if (processRq) {
    relevantCols.push(
      cols.RQ_STATUS,
      cols.RQ_DATE
    );
  }

  if (processCheck) {
    relevantCols.push(
      cols.CHECK_STATUS,
      cols.CHECK_DATE
    );
  }

  const minCol =
    Math.min.apply(null, relevantCols);

  const maxCol =
    Math.max.apply(null, relevantCols);

  const width =
    maxCol - minCol + 1;

  // 1 bulk read.
  const values = sh
    .getRange(
      startRow,
      minCol,
      numRows,
      width
    )
    .getValues();

  const rqStatusIdx =
    cols.RQ_STATUS - minCol;

  const rqDateIdx =
    cols.RQ_DATE - minCol;

  const checkStatusIdx =
    cols.CHECK_STATUS - minCol;

  const checkDateIdx =
    cols.CHECK_DATE - minCol;

  /*
   * Chỉ lưu row THỰC SỰ cần thay đổi.
   * Không rewrite cả cột date => không biến formula/giá trị ở row
   * không thay đổi thành static value.
   */
  const rqFillRows = [];
  const rqClearRows = [];
  const checkFillRows = [];
  const checkClearRows = [];

  for (let i = 0; i < numRows; i++) {
    const row =
      startRow + i;

    stats.checkedRows++;

    let rowChanged = false;

    if (processRq) {
      const oldDate =
        values[i][rqDateIdx];

      const done =
        dateStatusContainsDone_(
          values[i][rqStatusIdx]
        );

      if (done) {
        if (!oldDate) {
          rqFillRows.push(row);
          stats.rqFilled++;
          rowChanged = true;
        }

      } else if (
        oldDate !== '' &&
        oldDate !== null
      ) {
        rqClearRows.push(row);
        stats.rqCleared++;
        rowChanged = true;
      }
    }

    if (processCheck) {
      const oldDate =
        values[i][checkDateIdx];

      const done =
        dateStatusContainsDone_(
          values[i][checkStatusIdx]
        );

      if (done) {
        if (!oldDate) {
          checkFillRows.push(row);
          stats.checkedFilled++;
          rowChanged = true;
        }

      } else if (
        oldDate !== '' &&
        oldDate !== null
      ) {
        checkClearRows.push(row);
        stats.checkedCleared++;
        rowChanged = true;
      }
    }

    if (!rowChanged) {
      stats.unchanged++;
    }
  }

  /*
   * RangeList cho phép 1 operation trên nhiều range rời rạc.
   * Google Apps Script hỗ trợ setValue / clearContent /
   * setNumberFormat cho RangeList.
   *
   * Mỗi cột tối đa:
   * - 1 fill operation
   * - 1 clear operation
   * - 1 format operation cho cells vừa fill
   */
  dateStatusApplyDateActions_(
    sh,
    cols.RQ_DATE,
    rqFillRows,
    rqClearRows,
    now,
    DATE_STATUS_CFG.RQ_FORMAT
  );

  dateStatusApplyDateActions_(
    sh,
    cols.CHECK_DATE,
    checkFillRows,
    checkClearRows,
    now,
    DATE_STATUS_CFG.CHECK_FORMAT
  );

  console.log(
    '[DATE STATUS BATCH]' +
    ' rows=' +
    startRow +
    ':' +
    (startRow + numRows - 1) +
    ' | checked=' +
    stats.checkedRows +
    ' | rqFilled=' +
    stats.rqFilled +
    ' | rqCleared=' +
    stats.rqCleared +
    ' | checkedFilled=' +
    stats.checkedFilled +
    ' | checkedCleared=' +
    stats.checkedCleared +
    ' | unchanged=' +
    stats.unchanged +
    ' | hidden=' +
    stats.hiddenSkipped
  );

  return stats;
}


function dateStatusApplyDateActions_(
  sh,
  column,
  fillRows,
  clearRows,
  now,
  numberFormat
) {
  if (fillRows && fillRows.length) {
    const fillRanges =
      dateStatusRowsToA1Ranges_(
        fillRows,
        column
      );

    const fillList =
      sh.getRangeList(fillRanges);

    /*
     * Format trước, value sau:
     * - format fail => date chưa ghi, retry vẫn thấy blank.
     * - format success nhưng value fail => retry vẫn thấy blank và chạy lại.
     * Tránh case value đã ghi nhưng format fail rồi retry skip cell.
     */
    fillList.setNumberFormat(numberFormat);
    fillList.setValue(now);
  }

  if (clearRows && clearRows.length) {
    const clearRanges =
      dateStatusRowsToA1Ranges_(
        clearRows,
        column
      );

    sh
      .getRangeList(clearRanges)
      .clearContent();
  }
}


function dateStatusRowsToA1Ranges_(
  rows,
  column
) {
  if (!rows || !rows.length) {
    return [];
  }

  const colA1 =
    dateStatusColumnToA1_(column);

  const output = [];

  let start =
    Number(rows[0]);

  let previous =
    start;

  for (
    let i = 1;
    i < rows.length;
    i++
  ) {
    const current =
      Number(rows[i]);

    if (current === previous + 1) {
      previous = current;
      continue;
    }

    output.push(
      start === previous
        ? colA1 + start
        : colA1 +
          start +
          ':' +
          colA1 +
          previous
    );

    start = current;
    previous = current;
  }

  output.push(
    start === previous
      ? colA1 + start
      : colA1 +
        start +
        ':' +
        colA1 +
        previous
  );

  return output;
}


function dateStatusColumnToA1_(column) {
  let n =
    Math.floor(Number(column));

  if (!Number.isFinite(n) || n < 1) {
    throw new Error(
      'Column không hợp lệ: ' +
      column
    );
  }

  let letters = '';

  while (n > 0) {
    const remainder =
      (n - 1) % 26;

    letters =
      String.fromCharCode(
        65 + remainder
      ) +
      letters;

    n =
      Math.floor(
        (n - 1) / 26
      );
  }

  return letters;
}


/* ============================================================
 * LARGE EDIT PENDING QUEUE
 * ============================================================ */

function dateStatusAddPendingEdit_(item) {
  const guard = LockService.getScriptLock();

  if (!guard.tryLock(DATE_STATUS_CFG.LEASE_GUARD_WAIT_MS)) {
    /*
     * Một edit event không nên chờ lâu.
     * Nếu state lock bận, ghi fallback riêng bằng UUID để worker fold sau.
     */
    PropertiesService
      .getDocumentProperties()
      .setProperty(
        dateStatusKey_('PENDING_FALLBACK_' + Utilities.getUuid()),
        JSON.stringify({
          spreadsheetId: item.spreadsheetId,
          sheetId: Number(item.sheetId),
          startRow: Number(item.startRow),
          endRow: Number(item.endRow),
          processRq: item.processRq === true,
          processCheck: item.processCheck === true,
          createdAt: Date.now()
        })
      );

    // Nếu worker trigger bị mất, edit fallback vẫn phải tự chữa.
    if (!dateStatusEnsureWorkerTriggerSafe_()) {
      console.error(
        '[DATE STATUS] Pending edit đã lưu nhưng không tạo được worker trigger.'
      );
    }

    return;
  }

  try {
    dateStatusFoldPendingFallbacksLocked_();

    const props = PropertiesService.getDocumentProperties();
    const key = dateStatusKey_(DATE_STATUS_CFG.PENDING_EDIT_KEY);
    const existing = dateStatusLoadJson_(DATE_STATUS_CFG.PENDING_EDIT_KEY);
    const list = Array.isArray(existing) ? existing : [];

    list.push({
      spreadsheetId: item.spreadsheetId,
      sheetId: Number(item.sheetId),
      startRow: Number(item.startRow),
      endRow: Number(item.endRow),
      processRq: item.processRq === true,
      processCheck: item.processCheck === true,
      createdAt: Date.now()
    });

    const merged = dateStatusMergePendingEdits_(list);

    props.setProperty(
      key,
      JSON.stringify(merged)
    );

  } finally {
    guard.releaseLock();
  }

  // Cố tự chữa worker trigger nếu user lỡ xóa trigger.
  if (!dateStatusEnsureWorkerTriggerSafe_()) {
    console.error(
      '[DATE STATUS] Pending edit đã lưu nhưng worker trigger đang MISSING.'
    );
  }
}


function dateStatusPromotePendingEditIfIdle_() {
  const guard = LockService.getScriptLock();

  if (!guard.tryLock(DATE_STATUS_CFG.LEASE_GUARD_WAIT_MS)) {
    return;
  }

  try {
    dateStatusFoldPendingFallbacksLocked_();

    const currentJob = dateStatusLoadJob_();

    if (
      currentJob &&
      !dateStatusJobIsTerminal_(currentJob.status)
    ) {
      return;
    }

    const list = dateStatusLoadJson_(DATE_STATUS_CFG.PENDING_EDIT_KEY);

    if (!Array.isArray(list) || !list.length) {
      return;
    }

    /*
     * V14 transaction order:
     * 1. Peek item.
     * 2. Save new job.
     * 3. THEN remove item from pending.
     *
     * Nếu execution chết giữa 2 và 3 => edit bị xử lý lặp,
     * nhưng business rule idempotent. Không bị mất edit.
     */
    const item = list[0];
    const now = Date.now();

    PropertiesService
      .getDocumentProperties()
      .deleteProperty(
        dateStatusKey_(
          DATE_STATUS_CFG.LAST_ERROR_KEY
        )
      );

    const newJob = {
      version: 14,
      token: Utilities.getUuid(),
      mode: 'EDIT_RANGE',
      spreadsheetId: item.spreadsheetId,
      sheetId: Number(item.sheetId),
      sheetName: DATE_STATUS_CFG.SHEET_NAME,
      startRow: Number(item.startRow),
      endRow: Number(item.endRow),
      resolveEndRow: false,
      cursor: Number(item.startRow),
      lastSuccessRow: Number(item.startRow) - 1,
      processRq: item.processRq === true,
      processCheck: item.processCheck === true,
      skipHiddenByFilter: false,
      status: 'QUEUED',
      phase: 'QUEUED',
      startedAt: now,
      updatedAt: now,
      checkedRows: 0,
      rqFilled: 0,
      rqCleared: 0,
      checkedFilled: 0,
      checkedCleared: 0,
      unchanged: 0,
      hiddenSkipped: 0,
      hardRecoveryCount: 0,
      totalHardRecoveries: 0,
      transientRetryCount: 0,
      totalTransientRetries: 0,
      retryNotBefore: 0,
      recoveryBatchSize: DATE_STATUS_CFG.BATCH_SIZE,
      batchCursor: 0,
      batchNowMs: 0,
      errorPhase: '',
      errorRow: 0,
      errorMessage: ''
    };

    // Save job FIRST.
    dateStatusSaveJob_(newJob);

    // Dequeue AFTER job exists.
    const remaining = list.slice(1);
    const props = PropertiesService.getDocumentProperties();
    const key = dateStatusKey_(DATE_STATUS_CFG.PENDING_EDIT_KEY);

    if (remaining.length) {
      props.setProperty(key, JSON.stringify(remaining));
    } else {
      props.deleteProperty(key);
    }

  } finally {
    guard.releaseLock();
  }
}

function dateStatusMergePendingEdits_(items) {
  const clean = (items || [])
    .filter(function(item) {
      return (
        item &&
        item.spreadsheetId &&
        Number(item.sheetId) &&
        Number(item.startRow) >= DATE_STATUS_CFG.START_ROW &&
        Number(item.endRow) >= Number(item.startRow)
      );
    })
    .map(function(item) {
      return {
        spreadsheetId: item.spreadsheetId,
        sheetId: Number(item.sheetId),
        startRow: Number(item.startRow),
        endRow: Number(item.endRow),
        processRq: item.processRq === true,
        processCheck: item.processCheck === true,
        createdAt: Number(item.createdAt) || Date.now()
      };
    })
    .sort(function(a, b) {
      if (a.spreadsheetId !== b.spreadsheetId) {
        return a.spreadsheetId < b.spreadsheetId ? -1 : 1;
      }
      if (a.sheetId !== b.sheetId) return a.sheetId - b.sheetId;
      if (a.processRq !== b.processRq) return a.processRq ? -1 : 1;
      if (a.processCheck !== b.processCheck) return a.processCheck ? -1 : 1;
      return a.startRow - b.startRow;
    });

  const merged = [];

  clean.forEach(function(current) {
    const prev = merged.length ? merged[merged.length - 1] : null;

    if (
      prev &&
      prev.spreadsheetId === current.spreadsheetId &&
      prev.sheetId === current.sheetId &&
      prev.processRq === current.processRq &&
      prev.processCheck === current.processCheck &&
      current.startRow <= prev.endRow + 1
    ) {
      prev.endRow = Math.max(prev.endRow, current.endRow);
      prev.createdAt = Math.min(prev.createdAt, current.createdAt);
    } else {
      merged.push(current);
    }
  });

  if (merged.length <= DATE_STATUS_CFG.MAX_PENDING_ITEMS) {
    return merged;
  }

  /*
   * Không drop edit cũ.
   * Nếu queue quá nhiều range rời rạc, collapse theo
   * spreadsheet + sheet + loại xử lý thành minRow:maxRow.
   * Có thể xử lý thừa vài row ở giữa nhưng business rule idempotent,
   * an toàn hơn mất range.
   */
  const groups = {};

  merged.forEach(function(item) {
    const key = [
      item.spreadsheetId,
      item.sheetId,
      item.processRq ? 'R1' : 'R0',
      item.processCheck ? 'C1' : 'C0'
    ].join('|');

    if (!groups[key]) {
      groups[key] = {
        spreadsheetId: item.spreadsheetId,
        sheetId: item.sheetId,
        startRow: item.startRow,
        endRow: item.endRow,
        processRq: item.processRq,
        processCheck: item.processCheck,
        createdAt: item.createdAt
      };
      return;
    }

    groups[key].startRow = Math.min(groups[key].startRow, item.startRow);
    groups[key].endRow = Math.max(groups[key].endRow, item.endRow);
    groups[key].createdAt = Math.min(groups[key].createdAt, item.createdAt);
  });

  return Object.keys(groups).map(function(key) {
    return groups[key];
  });
}


function dateStatusFoldPendingFallbacksLocked_() {
  const props = PropertiesService.getDocumentProperties();
  const all = props.getProperties();
  const prefix = dateStatusKey_('PENDING_FALLBACK_');
  const pendingKey = dateStatusKey_(DATE_STATUS_CFG.PENDING_EDIT_KEY);
  const existing = dateStatusLoadJson_(DATE_STATUS_CFG.PENDING_EDIT_KEY);
  const list = Array.isArray(existing) ? existing.slice() : [];
  const deleteKeys = [];

  Object.keys(all).forEach(function(key) {
    if (key.indexOf(prefix) !== 0) return;

    try {
      const item = JSON.parse(all[key]);
      list.push(item);
    } catch (error) {}

    deleteKeys.push(key);
  });

  if (!deleteKeys.length) return;

  const merged = dateStatusMergePendingEdits_(list);

  if (merged.length) {
    props.setProperty(
      pendingKey,
      JSON.stringify(merged)
    );
  } else {
    props.deleteProperty(pendingKey);
  }

  deleteKeys.forEach(function(key) {
    props.deleteProperty(key);
  });
}

/* ============================================================
 * FINISH / STATUS / RESET
 * ============================================================ */

function dateStatusFinishJob_(job) {
  job.status = 'DONE';
  job.phase = 'DONE';
  job.cursor = Number(job.endRow) + 1;
  job.lastSuccessRow = Number(job.endRow);
  job.updatedAt = Date.now();
  job.batchCursor = 0;
  job.batchNowMs = 0;
  job.errorPhase = '';
  job.errorRow = 0;
  job.errorMessage = '';

  dateStatusSaveJob_(job);

  PropertiesService
    .getDocumentProperties()
    .deleteProperty(
      dateStatusKey_(
        DATE_STATUS_CFG.LAST_ERROR_KEY
      )
    );

  try {
    SpreadsheetApp
      .openById(job.spreadsheetId)
      .toast(
        'DONE ' + job.startRow + ':' + job.endRow +
        ' | RQ +' + job.rqFilled + '/-' + job.rqCleared +
        ' | Checked +' + job.checkedFilled + '/-' + job.checkedCleared,
        'DATE Tools',
        8
      );
  } catch (error) {
    console.log('[DATE STATUS] Finish toast error: ' + error);
  }
}


function showDateStatusProcessingStatus() {
  /*
   * Status không chỉ xem — nó cũng tự heal worker nếu còn work.
   * Nếu đang có execution giữ ScriptLock, reconcile sẽ bỏ qua an toàn.
   */
  dateStatusReconcileWorkerForCurrentWork_();

  const job = dateStatusLoadJob_();
  const lastError = dateStatusLoadJson_(DATE_STATUS_CFG.LAST_ERROR_KEY);
  const pending = dateStatusLoadJson_(DATE_STATUS_CFG.PENDING_EDIT_KEY);

  const props = PropertiesService.getDocumentProperties();
  const allProps = props.getProperties();
  const fallbackPrefix = dateStatusKey_('PENDING_FALLBACK_');
  const fallbackCount = Object.keys(allProps).filter(function(key) {
    return key.indexOf(fallbackPrefix) === 0;
  }).length;

  const lease = dateStatusLoadJson_(DATE_STATUS_CFG.EXECUTION_LEASE_KEY);

  const workerInstalled = ScriptApp
    .getProjectTriggers()
    .some(function(trigger) {
      return trigger.getHandlerFunction() === DATE_STATUS_CFG.WORKER_HANDLER;
    });

  const lines = ['DATE STATUS ENGINE V14', ''];

  const hasActiveJob =
    job && !dateStatusJobIsTerminal_(job.status);

  const hasPendingWork =
    (Array.isArray(pending) && pending.length > 0) ||
    fallbackCount > 0;

  let workerText;

  if (workerInstalled) {
    workerText = 'INSTALLED';
  } else if (hasActiveJob || hasPendingWork) {
    workerText = 'MISSING — WORK IS WAITING';
  } else {
    workerText = 'IDLE — no trigger needed';
  }

  lines.push('Worker trigger: ' + workerText);
  lines.push('Pending edits: ' + (Array.isArray(pending) ? pending.length : 0));
  lines.push('Pending fallback: ' + fallbackCount);

  if (lease && Number(lease.expiresAt || 0) > Date.now()) {
    lines.push(
      'Lease: ' + (lease.owner || 'DATE') +
      ' until ' + dateStatusFormatTime_(lease.expiresAt)
    );
  } else {
    lines.push('Lease: FREE');
  }

  lines.push('');

  if (!job) {
    lines.push('JOB: NONE');
  } else {
    lines.push('Mode: ' + job.mode);
    lines.push('Status: ' + job.status);
    lines.push('Phase: ' + job.phase);
    lines.push('Range: ' + job.startRow + ':' + (job.resolveEndRow ? 'RESOLVING' : job.endRow));
    lines.push('Next row: ' + job.cursor);
    lines.push('Last success row: ' + job.lastSuccessRow);
    lines.push('Checked rows: ' + job.checkedRows);
    lines.push('NGÀY RQ filled: ' + job.rqFilled);
    lines.push('NGÀY RQ cleared: ' + job.rqCleared);
    lines.push('Checked time filled: ' + job.checkedFilled);
    lines.push('Checked time cleared: ' + job.checkedCleared);
    lines.push('Unchanged: ' + job.unchanged);
    lines.push('Hidden skipped: ' + (Number(job.hiddenSkipped) || 0));
    lines.push(
      'Hard recovery current/total: ' +
      (Number(job.hardRecoveryCount) || 0) +
      '/' +
      (Number(job.totalHardRecoveries) || 0) +
      ' | Transient current/total: ' +
      (Number(job.transientRetryCount) || 0) +
      '/' +
      (Number(job.totalTransientRetries) || 0)
    );

    lines.push(
      'Batch size: ' +
      (Number(job.recoveryBatchSize) || DATE_STATUS_CFG.BATCH_SIZE) +
      ' | Batch cursor: ' +
      (Number(job.batchCursor) || '-')
    );

    if (Number(job.batchNowMs || 0)) {
      lines.push(
        'Batch timestamp: ' +
        dateStatusFormatTime_(
          job.batchNowMs
        )
      );
    }

    if (Number(job.retryNotBefore || 0) > Date.now()) {
      lines.push(
        'Retry after: ' + dateStatusFormatTime_(job.retryNotBefore)
      );
    }

    const heartbeatAgeMs =
      Date.now() - Number(job.updatedAt || job.startedAt || 0);

    lines.push(
      'Heartbeat age: ' +
      Math.max(0, Math.floor(heartbeatAgeMs / 1000)) +
      's'
    );

    if (
      !dateStatusJobIsTerminal_(job.status) &&
      Number(job.retryNotBefore || 0) <= Date.now() &&
      heartbeatAgeMs > DATE_STATUS_CFG.STALE_JOB_MS
    ) {
      lines.push(
        'WARNING: state stale > ' +
        Math.floor(DATE_STATUS_CFG.STALE_JOB_MS / 60000) +
        ' minutes. Worker should recover; otherwise Reset.'
      );
    }

    lines.push('Updated at: ' + dateStatusFormatTime_(job.updatedAt));

    if (job.errorMessage) {
      lines.push('');
      lines.push('JOB ERROR');
      lines.push('Phase: ' + job.errorPhase);
      lines.push('Row: ' + job.errorRow);
      lines.push(String(job.errorMessage).slice(0, 800));
    }
  }

  lines.push('');
  lines.push('LAST ERROR');

  if (lastError && lastError.message) {
    lines.push('Phase: ' + lastError.phase);
    lines.push('Row: ' + lastError.row);
    lines.push('Time: ' + dateStatusFormatTime_(lastError.updatedAt));
    lines.push(String(lastError.message).slice(0, 800));
  } else {
    lines.push('NONE');
  }

  const text = lines.join('\n');
  console.log('[DATE STATUS]\n' + text);

  const html = HtmlService
    .createHtmlOutput(
      '<div style="font-family:Arial,sans-serif;padding:16px;white-space:pre-wrap;line-height:1.5;font-size:13px">' +
      dateStatusEscapeHtml_(text) +
      '</div>'
    )
    .setWidth(600)
    .setHeight(650);

  SpreadsheetApp.getUi().showModalDialog(html, 'DATE Processing Status');
}


function resetDateStatusEngineState() {
  const resetStartedAt =
    Date.now();

  const leaseToken =
    dateStatusAcquireExecutionLease_(
      'RESET'
    );

  if (!leaseToken) {
    try {
      SpreadsheetApp
        .getActiveSpreadsheet()
        .toast(
          'Date worker đang xử lý. Chờ worker xong rồi Reset lại để tránh ghi chồng.',
          'DATE Tools',
          7
        );
    } catch (error) {}

    return false;
  }

  try {
    const guard =
      LockService.getScriptLock();

    if (
      !guard.tryLock(
        DATE_STATUS_CFG.LEASE_RELEASE_WAIT_MS
      )
    ) {
      return false;
    }

    try {
      const props =
        PropertiesService
          .getDocumentProperties();

      /*
       * Job + last error thuộc trạng thái trước reset => xóa.
       */
      props.deleteProperty(
        dateStatusKey_(
          DATE_STATUS_CFG.JOB_KEY
        )
      );

      props.deleteProperty(
        dateStatusKey_(
          DATE_STATUS_CFG.LAST_ERROR_KEY
        )
      );

      /*
       * Pending main queue:
       * chỉ xóa item được tạo trước/đúng thời điểm Reset bắt đầu.
       * Edit mới tới trong lúc reset được giữ lại.
       */
      const pendingKey =
        dateStatusKey_(
          DATE_STATUS_CFG.PENDING_EDIT_KEY
        );

      const pending =
        dateStatusLoadJson_(
          DATE_STATUS_CFG.PENDING_EDIT_KEY
        );

      if (
        Array.isArray(pending) &&
        pending.length
      ) {
        const keep =
          pending.filter(function(item) {
            return (
              Number(
                item &&
                item.createdAt
              ) >
              resetStartedAt
            );
          });

        if (keep.length) {
          props.setProperty(
            pendingKey,
            JSON.stringify(
              dateStatusMergePendingEdits_(
                keep
              )
            )
          );
        } else {
          props.deleteProperty(
            pendingKey
          );
        }

      } else {
        props.deleteProperty(
          pendingKey
        );
      }

      /*
       * Fallback UUID queue:
       * cùng nguyên tắc — chỉ xóa fallback cũ.
       */
      const all =
        props.getProperties();

      const fallbackPrefix =
        dateStatusKey_(
          'PENDING_FALLBACK_'
        );

      Object.keys(all)
        .forEach(function(key) {
          if (
            key.indexOf(
              fallbackPrefix
            ) !== 0
          ) {
            return;
          }

          let createdAt = 0;

          try {
            const item =
              JSON.parse(
                all[key]
              );

            createdAt =
              Number(
                item &&
                item.createdAt
              ) ||
              0;

          } catch (error) {
            // Corrupt fallback cũ => coi là state cũ để dọn.
            createdAt = 0;
          }

          if (
            createdAt <=
            resetStartedAt
          ) {
            props.deleteProperty(
              key
            );
          }
        });

      /*
       * Trigger hiện tại có thể thuộc job cũ.
       * Reconcile sau reset sẽ tạo lại nếu còn edit mới.
       */
      dateStatusDeleteWorkerTriggers_();

    } finally {
      guard.releaseLock();
    }

    console.log(
      '[DATE STATUS] V15 state reset. Sheet data không bị xóa.'
    );

    try {
      SpreadsheetApp
        .getActiveSpreadsheet()
        .toast(
          'Đã reset Date job/state. Dữ liệu ngày trên sheet không bị xóa.',
          'DATE Tools',
          6
        );
    } catch (error) {}

    return true;

  } finally {
    dateStatusReleaseExecutionLease_(
      leaseToken
    );

    dateStatusReconcileWorkerForCurrentWork_();
  }
}
function resetAndReloadRequestTechCheckedTime() {
  if (resetDateStatusEngineState() !== true) {
    return;
  }

  reloadRequestTechCheckedTime();
}


/* ============================================================
 * HEADER / RANGE HELPERS
 * ============================================================ */

function dateStatusGetColumns_(sh) {
  const lastColumn =
    sh.getLastColumn();

  if (lastColumn < 1) {
    throw new Error(
      'Sheet INPUT không có header.'
    );
  }

  const headers = sh
    .getRange(
      DATE_STATUS_CFG.HEADER_ROW,
      1,
      1,
      lastColumn
    )
    .getDisplayValues()[0];

  /*
   * Map về mảng vị trí thay vì giữ cột đầu tiên.
   * Duplicate required header phải báo lỗi rõ, không tự đoán.
   */
  const map = {};

  for (
    let i = 0;
    i < headers.length;
    i++
  ) {
    const key =
      dateStatusNormalizeHeader_(
        headers[i]
      );

    if (!key) continue;

    if (!map[key]) {
      map[key] = [];
    }

    map[key].push(i + 1);
  }

  const cols = {
    RQ_STATUS:
      dateStatusRequireUniqueHeader_(
        map,
        DATE_STATUS_CFG
          .HEADERS
          .RQ_STATUS
      ),

    RQ_DATE:
      dateStatusRequireUniqueHeader_(
        map,
        DATE_STATUS_CFG
          .HEADERS
          .RQ_DATE
      ),

    CHECK_STATUS:
      dateStatusRequireUniqueHeader_(
        map,
        DATE_STATUS_CFG
          .HEADERS
          .CHECK_STATUS
      ),

    CHECK_DATE:
      dateStatusRequireUniqueHeader_(
        map,
        DATE_STATUS_CFG
          .HEADERS
          .CHECK_DATE
      )
  };

  dateStatusValidateDistinctColumns_(
    cols
  );

  return cols;
}


function dateStatusRequireUniqueHeader_(
  map,
  headerName
) {
  const key =
    dateStatusNormalizeHeader_(
      headerName
    );

  const positions =
    map[key] || [];

  if (!positions.length) {
    throw new Error(
      'Không tìm thấy header "' +
      headerName +
      '" trong INPUT.'
    );
  }

  if (positions.length > 1) {
    throw new Error(
      'Header "' +
      headerName +
      '" bị trùng ở các cột: ' +
      positions.join(', ') +
      '. Hãy giữ đúng 1 cột.'
    );
  }

  return positions[0];
}


function dateStatusNormalizeHeader_(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}


function dateStatusValidateDistinctColumns_(cols) {
  const seen = {};

  Object.keys(cols).forEach(function(key) {
    const column = cols[key];

    if (seen[column]) {
      throw new Error(
        'Header "' + key + '" và "' + seen[column] +
        '" đang trỏ cùng cột ' + column + '.'
      );
    }

    seen[column] = key;
  });
}


function dateStatusGetLastDataRowFast_(sh, column) {
  column = Number(column);

  if (
    !Number.isFinite(column) ||
    column < 1 ||
    column > sh.getMaxColumns()
  ) {
    throw new Error('Column không hợp lệ: ' + column);
  }

  const maxRows = sh.getMaxRows();

  if (maxRows < DATE_STATUS_CFG.START_ROW) {
    return DATE_STATUS_CFG.START_ROW - 1;
  }

  const lastCell = sh
    .getRange(maxRows, Math.floor(column))
    .getNextDataCell(SpreadsheetApp.Direction.UP);

  const candidateRow = lastCell.getRow();
  const candidateText = String(lastCell.getDisplayValue() || '').trim();

  if (
    candidateRow >= DATE_STATUS_CFG.START_ROW &&
    candidateText !== ''
  ) {
    return candidateRow;
  }

  /*
   * Edge case: bottommost "data cell" có formula trả "".
   * getNextDataCell có thể dừng ở formula đó dù display blank.
   * Khi đó scan ngược từng chunk nhỏ phía trên để không bỏ sót
   * status/date thật.
   */
  let endRow = Math.min(
    sh.getLastRow(),
    Math.max(
      candidateRow - 1,
      DATE_STATUS_CFG.START_ROW - 1
    )
  );

  const CHUNK = 2000;

  while (endRow >= DATE_STATUS_CFG.START_ROW) {
    const startRow = Math.max(
      DATE_STATUS_CFG.START_ROW,
      endRow - CHUNK + 1
    );

    const values = sh
      .getRange(
        startRow,
        Math.floor(column),
        endRow - startRow + 1,
        1
      )
      .getDisplayValues();

    for (let i = values.length - 1; i >= 0; i--) {
      if (String(values[i][0] || '').trim() !== '') {
        return startRow + i;
      }
    }

    endRow = startRow - 1;
  }

  return DATE_STATUS_CFG.START_ROW - 1;
}

function dateStatusRangeTouchesColumn_(startCol, endCol, targetCol) {
  return startCol <= targetCol && endCol >= targetCol;
}


function dateStatusContainsDone_(value) {
  return /\bDONE\b/i.test(String(value || ''));
}


/* ============================================================
 * EXECUTION LEASE
 *
 * ScriptLock chỉ giữ vài ms để atomically lấy/thả lease.
 * Lease mới là thứ ngăn worker và onEdit ghi sheet cùng lúc.
 * ============================================================ */

function dateStatusAcquireExecutionLease_(owner) {
  const guard = LockService.getScriptLock();

  if (!guard.tryLock(DATE_STATUS_CFG.LEASE_GUARD_WAIT_MS)) {
    return '';
  }

  try {
    const props = PropertiesService.getDocumentProperties();
    const key = dateStatusKey_(DATE_STATUS_CFG.EXECUTION_LEASE_KEY);
    const now = Date.now();
    const raw = props.getProperty(key);

    if (raw) {
      try {
        const current = JSON.parse(raw);

        if (
          current &&
          current.token &&
          Number(current.expiresAt) > now
        ) {
          return '';
        }
      } catch (error) {
        // Corrupt/legacy lease => overwrite.
      }
    }

    const token = Utilities.getUuid() + '_' + now;

    props.setProperty(
      key,
      JSON.stringify({
        token: token,
        owner: owner || 'DATE',
        startedAt: now,
        expiresAt: now + DATE_STATUS_CFG.EXECUTION_LEASE_MS
      })
    );

    return token;

  } finally {
    guard.releaseLock();
  }
}


function dateStatusReleaseExecutionLease_(token) {
  if (!token) return;

  const guard = LockService.getScriptLock();

  if (!guard.tryLock(DATE_STATUS_CFG.LEASE_RELEASE_WAIT_MS)) {
    console.error(
      '[DATE STATUS] Không lấy được ScriptLock để release lease; ' +
      'lease sẽ tự hết hạn.'
    );
    return;
  }

  try {
    const props = PropertiesService.getDocumentProperties();
    const key = dateStatusKey_(DATE_STATUS_CFG.EXECUTION_LEASE_KEY);
    const raw = props.getProperty(key);

    if (!raw) return;

    try {
      const current = JSON.parse(raw);

      if (current && current.token === token) {
        props.deleteProperty(key);
      }
    } catch (error) {
      props.deleteProperty(key);
    }

  } finally {
    guard.releaseLock();
  }
}


function dateStatusEnsureWorkerTriggerSafe_() {
  try {
    const ok = dateStatusEnsureWorkerTrigger_();

    if (!ok) {
      return false;
    }

    return ScriptApp
      .getProjectTriggers()
      .some(function(trigger) {
        return (
          trigger.getHandlerFunction() ===
          DATE_STATUS_CFG.WORKER_HANDLER
        );
      });

  } catch (error) {
    console.error(
      '[DATE STATUS] Worker trigger ensure failed: ' +
      dateStatusFormatError_(error)
    );

    return false;
  }
}


/* ============================================================
 * STATE HELPERS
 * ============================================================ */

function dateStatusLoadJob_() {
  return dateStatusLoadJson_(DATE_STATUS_CFG.JOB_KEY);
}


function dateStatusSaveJob_(job) {
  PropertiesService
    .getDocumentProperties()
    .setProperty(
      dateStatusKey_(DATE_STATUS_CFG.JOB_KEY),
      JSON.stringify(job)
    );
}


function dateStatusLoadJson_(keyName) {
  const raw = PropertiesService
    .getDocumentProperties()
    .getProperty(dateStatusKey_(keyName));

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}


function dateStatusSaveLastError_(job, error) {
  const payload = {
    phase: job.errorPhase || job.phase || 'UNKNOWN',
    row: Number(job.errorRow || job.cursor || job.startRow) || 0,
    mode: job.mode || '',
    message: dateStatusFormatError_(error),
    updatedAt: Date.now()
  };

  PropertiesService
    .getDocumentProperties()
    .setProperty(
      dateStatusKey_(DATE_STATUS_CFG.LAST_ERROR_KEY),
      JSON.stringify(payload)
    );
}


function dateStatusJobIsTerminal_(status) {
  return status === 'DONE' || status === 'ERROR' || status === 'CANCELLED';
}


function dateStatusKey_(name) {
  return DATE_STATUS_CFG.PREFIX + name;
}


/* ============================================================
 * ERROR / DISPLAY HELPERS
 * ============================================================ */

function dateStatusIsTransientError_(error) {
  const message = String(
    error && (error.message || error) || ''
  ).toLowerCase();

  return (
    message.indexOf('timed out') !== -1 ||
    message.indexOf('time out') !== -1 ||
    message.indexOf('service spreadsheets') !== -1 ||
    message.indexOf('internal error') !== -1 ||
    message.indexOf('try again') !== -1 ||
    message.indexOf('temporarily') !== -1 ||
    message.indexOf('rate limit') !== -1 ||
    message.indexOf('too many') !== -1 ||
    message.indexOf('quota') !== -1 ||
    message.indexOf('vượt quá thời gian') !== -1
  );
}


function dateStatusFormatError_(error) {
  if (!error) return 'Unknown error';
  return String(error.stack || error.message || error).slice(0, 1200);
}


function dateStatusFormatTime_(value) {
  const ms = Number(value) || 0;
  if (!ms) return '-';

  try {
    return Utilities.formatDate(
      new Date(ms),
      'Asia/Ho_Chi_Minh',
      'dd/MM/yyyy HH:mm:ss'
    );
  } catch (error) {
    return new Date(ms).toISOString();
  }
}


function dateStatusEscapeHtml_(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
