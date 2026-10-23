/***************************************************************
 * Brand.gs — SMART BRAND DETECTOR
 * BẢN V6 — CACHE INVALIDATION + TRANSIENT RETRY + WATCHDOG
 * =============================================================
 *
 * INPUT:
 *   B = Brand
 *   C = Model K
 *   E = full SEO
 *
 * SEO NAME RULE:
 *   A = KEY
 *   B = SEO NAME
 *   C = TYPE
 *   D = BRAND CODE  
 *   E = PRIORITY
 *
 * GIỮ NGUYÊN CÁC HÀM CŨ:
 *   01. smartUpdateBrands
 *   02. loadSmartBrandRules_
 *   03. createSmartBrandRule_
 *   04. detectSmartBrand_
 *   05. buildSmartBrandRegex_
 *   06. normalizeBrandText_
 *   07. createBrandFingerprint_
 *   08. md5String_
 *   09. loadSmartBrandCache_
 *   10. saveSmartBrandCache_
 *   11. writeChangedBrandBlocks_
 *   12. cleanString_
 *   13. escapeSmartRegex_
 *   14. forceRebuildAllBrands
 *   15. clearSmartBrandCache_
 *   16. testCurrentBrandRow
 *
 * NÂNG CẤP:
 * - Không còn quét toàn bộ sheet trong 1 execution.
 * - Full scan chia batch và lưu cursor.
 * - Timeout giữa chừng => lần sau chạy tiếp từ cursor.
 * - Cache fingerprint vẫn được giữ.
 * - Brand trống => detect.
 * - Model K đổi => detect lại.
 * - full SEO đổi => detect lại.
 * - Dòng không đổi => SKIP.
 * - SEO NAME RULE đổi => rebuild toàn bộ THEO BATCH.
 * - Dòng mới => tự đưa vào pending.
 * - Có thể mark range pending từ import/SEO.
 * - Collab nhiều brand => PRIORITY nhỏ nhất thắng.
 * - Cùng PRIORITY => rule dài/cụ thể hơn thắng.
 * - Không dùng onOpen().
 * - Không dùng formula.
 ***************************************************************/


const SMART_BRAND_CONFIG = {

  // ===========================================================
  // SHEET
  // ===========================================================
  INPUT_SHEET: 'INPUT',
  RULE_SHEET: 'SEO NAME RULE',

  HEADER_ROW: 1,
  START_ROW: 2,

  // ===========================================================
  // INPUT COLUMNS
  // ===========================================================
  BRAND_COL: 2,       // B
  MODEL_COL: 3,       // C
  FULL_SEO_COL: 5,    // E

  // ===========================================================
  // SEO NAME RULE COLUMNS
  // ===========================================================
  RULE_KEY_COL: 1,        // A
  RULE_NAME_COL: 2,       // B
  RULE_TYPE_COL: 3,       // C
  RULE_BRAND_COL: 4,      // D
  RULE_PRIORITY_COL: 5,   // E

  // ===========================================================
  // CACHE
  // ===========================================================
  PROPERTY_PREFIX: 'SMART_BRAND_',

  /*
   * Code cũ dùng 400 fingerprint/chunk.
   * Fingerprint cũ là MD5 32 ký tự => property dễ quá lớn.
   *
   * Bản mới dùng fingerprint hash ngắn + chunk 200
   * để an toàn hơn với PropertiesService.
   */
  CACHE_CHUNK_SIZE: 200,

  // Rule cache giữa các execution để không đọc/compile SEO NAME RULE lặp lại.
  RULE_CACHE_SECONDS: 600,
  RULE_CACHE_CHUNK_CHARS: 50000,
  RULE_CACHE_VERSION: "V6",
  RULE_CACHE_INVALIDATOR_HANDLER: "brandRuleCacheOnEdit_",

  // ===========================================================
  // PERFORMANCE
  // ===========================================================

  /*
   * Mỗi execution chỉ xử lý tối đa số dòng này.
   * V3 dùng micro-batch 60 dòng để luôn kịp save cursor.
   * Không cố giữ execution dài.
   */
  BATCH_SIZE: 40,

  /*
   * Ngưỡng thời gian nội bộ.
   * Chủ động dừng khoảng 25 giây để còn thời gian write + save state.
   * Tránh Apps Script timeout trước khi checkpoint.
   */
  MAX_RUNTIME_MS: 18000,

  /*
   * Trigger resume sau khoảng 1 phút.
   */
  CONTINUE_AFTER_MS: 5000,

  /*
   * BRAND-SPECIFIC LEASE:
   * Không giữ DocumentLock suốt execution nữa.
   * ScriptLock chỉ dùng cực ngắn để atomically lấy/thả lease Brand.
   * Nhờ vậy SEO / RQ Date / Checked Date không bị Brand khóa chung.
   */
  EXECUTION_LEASE_MS: 390000,
  LEASE_LOCK_WAIT_MS: 5000,

  // SELECTED BRAND — job riêng, khóa vùng ngay khi bấm
  SELECTED_BATCH_SIZE: 40,
  SELECTED_MAX_CHUNKS_PER_RUN: 1,
  SELECTED_MAX_RUNTIME_MS: 15000,
  SELECTED_CONTINUE_AFTER_MS: 5000,
  SELECTED_CONTINUE_HANDLER: 'continueSelectedBrandUpdate_',
  SELECTED_WATCHDOG_AFTER_MS: 45000,
  SELECTED_WATCHDOG_HANDLER: 'watchdogSelectedBrandUpdate_',

  BACKGROUND_WATCHDOG_AFTER_MS: 45000,
  BACKGROUND_WATCHDOG_HANDLER: 'watchdogSmartBrandUpdate_',

  TRANSIENT_RETRY_LIMIT: 5,

  // Giữ lại config cũ để không phá code tham chiếu.
  WRITE_BLOCK_SIZE: 500
};


/***************************************************************
 * PROPERTY KEYS
 ***************************************************************/
const SMART_BRAND_KEYS = {
  RULE_HASH: 'RULE_HASH',
  ACTIVE_RULE_HASH: 'ACTIVE_RULE_HASH',

  REBUILD_ACTIVE: 'REBUILD_ACTIVE',
  REBUILD_CURSOR: 'REBUILD_CURSOR',

  SCAN_CURSOR: 'SCAN_CURSOR',
  LAST_KNOWN_LAST_ROW: 'LAST_KNOWN_LAST_ROW',

  PENDING_RANGES: 'PENDING_RANGES',

  EXECUTION_LEASE: 'EXECUTION_LEASE',
  SPREADSHEET_ID: 'SPREADSHEET_ID_V6',

  SELECTED_JOB: 'SELECTED_JOB_V6',
  LAST_ERROR: 'LAST_ERROR_V6',
  FULL_SCAN_STATE: 'FULL_SCAN_STATE_V6',
  PENDING_STATE: 'PENDING_STATE_V6',
  ROLLING_STATE: 'ROLLING_STATE_V6',
  LAST_ACTIVITY: 'LAST_ACTIVITY_V6',
  BACKGROUND_RETRY_COUNT: 'BACKGROUND_RETRY_COUNT_V6'
};


/***************************************************************
 * HÀM CHÍNH
 *
 * GIỮ NGUYÊN TÊN HÀM CŨ:
 *
 * smartUpdateBrands()
 *
 * CƠ CHẾ:
 *
 * 1. Rule đổi?
 *    => full rebuild theo batch.
 *
 * 2. Có pending rows?
 *    => xử lý pending trước.
 *
 * 3. Có dòng append mới?
 *    => tự queue pending.
 *
 * 4. Không có pending?
 *    => rolling scan 1 batch.
 *
 * Rolling scan vẫn đọc tuần tự theo batch,
 * nhưng CHỈ detect nếu fingerprint đổi / Brand trống.
 ***************************************************************/
function smartUpdateBrands() {
  const entryStartedAt = Date.now();

  /*
   * Selected được ưu tiên. Nếu đang có Selected chờ/running,
   * background không chen vào giữa.
   */
  const selected = loadSelectedBrandJob_();
  if (
    selected &&
    (
      selected.status === 'QUEUED' ||
      selected.status === 'WAITING' ||
      selected.status === 'WAITING_LOCK' ||
      selected.status === 'RUNNING'
    )
  ) {
    console.log(
      '[BRAND BACKGROUND] WAIT_SELECTED' +
      ' | Status=' + selected.status +
      ' | Next=' + selected.cursor
    );
    scheduleBrandWatchdog_();
    return;
  }

  const leaseToken = acquireBrandExecutionLease_('BACKGROUND');

  if (!leaseToken) {
    console.log('[BRAND BACKGROUND] WAITING_LOCK');
    scheduleBrandWatchdog_();
    return;
  }

  scheduleBrandWatchdog_();

  try {
    const ss = getBrandSpreadsheet_();
    if (!ss) {
      throw new Error(
        'Không xác định được Spreadsheet cho Brand background.'
      );
    }

    rememberBrandSpreadsheet_(ss);

    const inputSheet = ss.getSheetByName(
      SMART_BRAND_CONFIG.INPUT_SHEET
    );
    const ruleSheet = ss.getSheetByName(
      SMART_BRAND_CONFIG.RULE_SHEET
    );

    if (!inputSheet) {
      throw new Error(
        'Không tìm thấy sheet "' +
        SMART_BRAND_CONFIG.INPUT_SHEET +
        '".'
      );
    }

    if (!ruleSheet) {
      throw new Error(
        'Không tìm thấy sheet "' +
        SMART_BRAND_CONFIG.RULE_SHEET +
        '".'
      );
    }

    const ruleLoadStartedAt = Date.now();
    const ruleData = loadSmartBrandRules_(ruleSheet);
    const rules = ruleData.rules;
    const currentRuleHash = ruleData.hash;

    console.log(
      '[BRAND BACKGROUND] RULES_READY' +
      ' | Rules=' + rules.length +
      ' | ' + (Date.now() - ruleLoadStartedAt) + 'ms'
    );

    if (!rules.length) {
      throw new Error('Không có rule Brand hợp lệ.');
    }

    /*
     * QUAN TRỌNG:
     * Runtime của batch bắt đầu SAU KHI load rules xong.
     * Bản cũ tính từ đầu execution nên nếu load rules >25s
     * Full Scan sẽ dừng trước row đầu tiên.
     */
    const batchStartedAt = Date.now();

    const properties = PropertiesService.getDocumentProperties();
    const lastRow = getLastBrandSourceRow_(inputSheet);

    if (lastRow < SMART_BRAND_CONFIG.START_ROW) {
      return;
    }

    prepareBrandRuleRebuildIfNeeded_(
      properties,
      currentRuleHash
    );

    autoQueueNewBrandRows_(
      properties,
      lastRow
    );

    if (isBrandRebuildActive_(properties)) {
      console.log(
        '[BRAND BACKGROUND] MODE=FULL_SCAN' +
        ' | Cursor=' +
        (
          properties.getProperty(
            brandPropertyKey_(SMART_BRAND_KEYS.REBUILD_CURSOR)
          ) ||
          SMART_BRAND_CONFIG.START_ROW
        )
      );

      processBrandRebuildBatch_(
        inputSheet,
        rules,
        properties,
        currentRuleHash,
        lastRow,
        batchStartedAt
      );

      resetBrandBackgroundRetry_();
      return;
    }

    const pendingRanges =
      loadBrandPendingRanges_(properties);

    if (pendingRanges.length) {
      console.log(
        '[BRAND BACKGROUND] MODE=PENDING' +
        ' | Range=' +
        pendingRanges[0][0] +
        ':' +
        pendingRanges[0][1]
      );

      processBrandPendingBatch_(
        inputSheet,
        rules,
        properties,
        pendingRanges,
        batchStartedAt
      );

      resetBrandBackgroundRetry_();
      return;
    }

    console.log('[BRAND BACKGROUND] MODE=ROLLING');

    processBrandRollingBatch_(
      inputSheet,
      rules,
      properties,
      lastRow,
      batchStartedAt
    );

    resetBrandBackgroundRetry_();

  } catch (error) {
    saveBrandLastError_(error, 'SMART_UPDATE');

    const transient =
      isTransientBrandError_(error);

    const retryCount =
      transient
        ? incrementBrandBackgroundRetry_()
        : getBrandBackgroundRetry_();

    const retryLimit =
      Number(SMART_BRAND_CONFIG.TRANSIENT_RETRY_LIMIT) || 5;

    if (
      transient &&
      retryCount <= retryLimit
    ) {
      scheduleBrandContinuation_();

      console.warn(
        '[BRAND BACKGROUND] TRANSIENT_RETRY' +
        ' | Attempt=' + retryCount +
        '/' + retryLimit +
        ' | ' + brandShortError_(error)
      );
    } else {
      console.error(
        '[BRAND] ERROR: ' +
        (
          error && error.stack
            ? error.stack
            : error
        )
      );
    }

  } finally {
    releaseBrandExecutionLease_(leaseToken);
    deleteBrandWatchdogTriggers_();

    console.log(
      '[BRAND BACKGROUND] EXECUTION_END' +
      ' | ' + (Date.now() - entryStartedAt) + 'ms'
    );
  }
}

/***************************************************************
 * UPDATE SELECTED BRAND ROWS — JOB RIÊNG
 *
 * - Snapshot sheetId + startRow + endRow ngay lúc bấm.
 * - Sau đó không đọc ActiveRange/ActiveSheet nữa.
 * - Không dùng SCAN_CURSOR.
 * - Không mark Pending sau khi chạy.
 * - Chỉ write những Brand thật sự thay đổi.
 ***************************************************************/
function updateSelectedBrandRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getActiveSheet() : null;

  if (
    !ss ||
    !sheet ||
    sheet.getName() !== SMART_BRAND_CONFIG.INPUT_SHEET
  ) {
    if (ss) {
      ss.toast(
        'Hãy chọn vùng cần cập nhật trong INPUT.',
        'BRAND SELECTED',
        5
      );
    }
    return;
  }

  rememberBrandSpreadsheet_(ss);
  ensureBrandRuleInvalidationTrigger_(ss);

  const activeRange = sheet.getActiveRange();
  if (!activeRange) {
    return;
  }

  const startRow = Math.max(
    SMART_BRAND_CONFIG.START_ROW,
    activeRange.getRow()
  );

  const endRow = Math.min(
    sheet.getLastRow(),
    activeRange.getRow() +
      activeRange.getNumRows() -
      1
  );

  if (startRow > endRow) {
    ss.toast(
      'Vùng chọn không có dòng dữ liệu.',
      'BRAND SELECTED',
      5
    );
    return;
  }

  const liveLease = getBrandExecutionLeaseState_();
  const oldJob = loadSelectedBrandJob_();

  if (
    liveLease &&
    liveLease.mode === 'SELECTED' &&
    oldJob &&
    (
      oldJob.status === 'RUNNING' ||
      oldJob.status === 'WAITING_LOCK'
    )
  ) {
    ss.toast(
      'Selected Brand đang chạy rows ' +
      oldJob.startRow + ':' + oldJob.endRow +
      ' | Last success ' + oldJob.lastSuccessRow +
      ' | Next ' + oldJob.cursor,
      'BRAND SELECTED',
      8
    );
    return;
  }

  deleteSelectedBrandContinuationTriggers_();
  deleteSelectedBrandWatchdogTriggers_();

  const now = Date.now();

  const job = {
    version: 6,
    token: Utilities.getUuid(),
    spreadsheetId: ss.getId(),
    sheetId: sheet.getSheetId(),
    startRow: startRow,
    endRow: endRow,
    cursor: startRow,
    lastSuccessRow: startRow - 1,
    status: 'QUEUED',
    phase: 'QUEUED',
    startedAt: now,
    updatedAt: now,
    heartbeatAt: now,
    checked: 0,
    matched: 0,
    filled: 0,
    updated: 0,
    unresolved: 0,
    noSourceSkipped: 0,
    batchesCompleted: 0,
    retryCount: 0,
    errorPhase: '',
    errorRow: 0,
    errorMessage: ''
  };

  saveSelectedBrandJob_(job);
  scheduleSelectedBrandContinuation_();
  scheduleSelectedBrandWatchdog_();

  ss.toast(
    'QUEUED rows ' +
    startRow + ':' + endRow +
    '. Selection đã khóa. Brand worker sẽ tự chạy.',
    'BRAND SELECTED',
    7
  );
}


function processSelectedBrandJob_() {
  let job = loadSelectedBrandJob_();

  if (
    !job ||
    (
      job.status !== 'QUEUED' &&
      job.status !== 'WAITING' &&
      job.status !== 'WAITING_LOCK' &&
      job.status !== 'RUNNING'
    )
  ) {
    deleteSelectedBrandContinuationTriggers_();
    deleteSelectedBrandWatchdogTriggers_();
    return;
  }

  const originalToken = job.token;
  let phase = 'ACQUIRE_LOCK';
  let batchStart = Number(job.cursor) || Number(job.startRow);

  const leaseToken =
    acquireBrandExecutionLease_(
      'SELECTED',
      originalToken
    );

  if (!leaseToken) {
    job.status = 'WAITING_LOCK';
    job.phase = 'WAITING_LOCK';
    job.updatedAt = Date.now();
    job.heartbeatAt = job.updatedAt;
    saveSelectedBrandJobIfCurrent_(job);

    console.log(
      '[BRAND SELECTED] WAITING_LOCK' +
      ' | Range=' + job.startRow + ':' + job.endRow +
      ' | Next=' + job.cursor
    );

    scheduleSelectedBrandWatchdog_();
    return;
  }

  scheduleSelectedBrandWatchdog_();

  try {
    job = loadSelectedBrandJob_();

    if (
      !job ||
      job.token !== originalToken
    ) {
      return;
    }

    job.status = 'RUNNING';
    job.phase = 'OPEN_SHEET';
    job.updatedAt = Date.now();
    job.heartbeatAt = job.updatedAt;
    saveSelectedBrandJobIfCurrent_(job);

    const ss = SpreadsheetApp.openById(job.spreadsheetId);
    const sheet = ss.getSheets().find(function(sh) {
      return sh.getSheetId() === Number(job.sheetId);
    });

    if (!sheet) {
      throw new Error(
        'Không tìm thấy sheetId ' +
        job.sheetId +
        ' của Selected Brand job.'
      );
    }

    phase = 'LOAD_RULES';
    job.phase = phase;
    job.updatedAt = Date.now();
    job.heartbeatAt = job.updatedAt;
    saveSelectedBrandJobIfCurrent_(job);

    const ruleSheet = ss.getSheetByName(
      SMART_BRAND_CONFIG.RULE_SHEET
    );

    if (!ruleSheet) {
      throw new Error(
        'Không tìm thấy sheet "' +
        SMART_BRAND_CONFIG.RULE_SHEET +
        '".'
      );
    }

    const ruleLoadStartedAt = Date.now();
    const ruleData = loadSmartBrandRules_(ruleSheet);
    const rules = ruleData.rules;

    console.log(
      '[BRAND SELECTED] RULES_READY' +
      ' | Rules=' + rules.length +
      ' | ' + (Date.now() - ruleLoadStartedAt) + 'ms'
    );

    if (!rules.length) {
      throw new Error(
        'Không có rule Brand hợp lệ.'
      );
    }

    /*
     * Timer batch bắt đầu SAU load rules.
     * Đây là fix trực tiếp cho bug V4:
     * load rules lâu >20s làm mỗi execution chỉ xử lý 1 row.
     */
    const processingStartedAt = Date.now();

    batchStart = Math.max(
      Number(job.cursor) || Number(job.startRow),
      Number(job.startRow)
    );

    if (batchStart > Number(job.endRow)) {
      finishSelectedBrandJob_(job);
      return;
    }

    const requestedRows = Math.min(
      Number(SMART_BRAND_CONFIG.SELECTED_BATCH_SIZE) || 20,
      Number(job.endRow) - batchStart + 1
    );

    const batchEnd =
      batchStart + requestedRows - 1;

    phase =
      'READ_ROWS_' +
      batchStart +
      '_TO_' +
      batchEnd;

    job.phase = phase;
    job.updatedAt = Date.now();
    job.heartbeatAt = job.updatedAt;
    saveSelectedBrandJobIfCurrent_(job);

    const data = sheet.getRange(
      batchStart,
      SMART_BRAND_CONFIG.BRAND_COL,
      requestedRows,
      SMART_BRAND_CONFIG.FULL_SEO_COL -
        SMART_BRAND_CONFIG.BRAND_COL +
        1
    ).getDisplayValues();

    const output = new Array(requestedRows);
    const changedLocalIndexes = [];
    const memo = Object.create(null);

    let checked = 0;
    let matched = 0;
    let filled = 0;
    let updated = 0;
    let unresolved = 0;
    let noSourceSkipped = 0;
    let processedRows = 0;

    phase = 'DETECT_BRAND';
    job.phase = phase;
    job.updatedAt = Date.now();
    job.heartbeatAt = job.updatedAt;
    saveSelectedBrandJobIfCurrent_(job);

    const safeRuntime =
      Number(
        SMART_BRAND_CONFIG.SELECTED_MAX_RUNTIME_MS
      ) || 15000;

    for (let i = 0; i < requestedRows; i++) {
      if (
        i > 0 &&
        Date.now() - processingStartedAt >= safeRuntime
      ) {
        break;
      }

      const currentBrand = cleanString_(data[i][0]);
      const modelK = cleanString_(data[i][1]);
      const fullSEO = cleanString_(data[i][3]);

      processedRows++;

      if (!modelK && !fullSEO) {
        noSourceSkipped++;
        continue;
      }

      checked++;

      const memoKey =
        modelK +
        '\u0001' +
        fullSEO;

      let result = memo[memoKey];

      if (!result) {
        result = detectSmartBrand_(
          modelK,
          fullSEO,
          rules
        );
        memo[memoKey] = result;
      }

      const expectedBrand =
        result.brand || '';

      if (!expectedBrand) {
        unresolved++;
        continue;
      }

      if (expectedBrand === currentBrand) {
        matched++;
        continue;
      }

      output[i] = [expectedBrand];
      changedLocalIndexes.push(i);

      if (!currentBrand) {
        filled++;
      } else {
        updated++;
      }
    }

    if (processedRows < 1) {
      throw new Error(
        'Selected Brand không xử lý được row nào trong batch.'
      );
    }

    phase =
      'WRITE_BRAND_' +
      batchStart +
      '_TO_' +
      (
        batchStart +
        processedRows -
        1
      );

    writeBrandRangeChanges_(
      sheet,
      batchStart,
      output,
      changedLocalIndexes
    );

    job.checked =
      (Number(job.checked) || 0) +
      checked;

    job.matched =
      (Number(job.matched) || 0) +
      matched;

    job.filled =
      (Number(job.filled) || 0) +
      filled;

    job.updated =
      (Number(job.updated) || 0) +
      updated;

    job.unresolved =
      (Number(job.unresolved) || 0) +
      unresolved;

    job.noSourceSkipped =
      (Number(job.noSourceSkipped) || 0) +
      noSourceSkipped;

    job.lastSuccessRow =
      batchStart +
      processedRows -
      1;

    job.cursor =
      job.lastSuccessRow + 1;

    job.batchesCompleted =
      (Number(job.batchesCompleted) || 0) + 1;

    job.updatedAt = Date.now();
    job.heartbeatAt = job.updatedAt;
    job.retryCount = 0;
    job.errorPhase = '';
    job.errorRow = 0;
    job.errorMessage = '';

    console.log(
      '[BRAND SELECTED] BATCH_END' +
      ' | Rows=' +
      batchStart + ':' +
      job.lastSuccessRow +
      ' | Checked=' + checked +
      ' | Matched=' + matched +
      ' | Filled=' + filled +
      ' | Updated=' + updated +
      ' | Unresolved=' + unresolved +
      ' | NoSource=' + noSourceSkipped +
      ' | Changed=' + changedLocalIndexes.length +
      ' | Next=' + job.cursor
    );

    if (
      Number(job.cursor) >
      Number(job.endRow)
    ) {
      finishSelectedBrandJob_(job);
      return;
    }

    job.status = 'WAITING';
    job.phase = 'WAITING_RESUME';
    saveSelectedBrandJobIfCurrent_(job);

    deleteSelectedBrandWatchdogTriggers_();
    scheduleSelectedBrandContinuation_();

  } catch (error) {
    const live = loadSelectedBrandJob_();
    const transient = isTransientBrandError_(error);
    const retryLimit =
      Number(SMART_BRAND_CONFIG.TRANSIENT_RETRY_LIMIT) || 5;

    if (
      live &&
      live.token === originalToken
    ) {
      job.updatedAt = Date.now();
      job.heartbeatAt = job.updatedAt;
      job.errorPhase = phase;
      job.errorRow = batchStart;
      job.errorMessage =
        brandFormatError_(error);

      if (
        transient &&
        (Number(job.retryCount) || 0) < retryLimit
      ) {
        job.retryCount =
          (Number(job.retryCount) || 0) + 1;
        job.status = 'WAITING';
        job.phase = 'TRANSIENT_RETRY';

        saveSelectedBrandJobIfCurrent_(job);

        deleteSelectedBrandContinuationTriggers_();
        deleteSelectedBrandWatchdogTriggers_();
        scheduleSelectedBrandContinuation_();
        scheduleSelectedBrandWatchdog_();

        console.warn(
          '[BRAND SELECTED] TRANSIENT_RETRY' +
          ' | Attempt=' + job.retryCount +
          '/' + retryLimit +
          ' | Row=' + batchStart +
          ' | ' + brandShortError_(error)
        );

      } else {
        job.status = 'ERROR';
        job.phase = 'ERROR';

        saveSelectedBrandJobIfCurrent_(job);

        deleteSelectedBrandContinuationTriggers_();
        deleteSelectedBrandWatchdogTriggers_();

        console.error(
          '[BRAND SELECTED ERROR] ' +
          JSON.stringify(job)
        );
      }
    }

  } finally {
    releaseBrandExecutionLease_(leaseToken);
  }
}

function finishSelectedBrandJob_(job) {
  job.status = 'DONE';
  job.phase = 'DONE';
  job.cursor = Number(job.endRow) + 1;
  job.lastSuccessRow = Number(job.endRow);
  job.updatedAt = Date.now();
  job.heartbeatAt = job.updatedAt;

  saveSelectedBrandJob_(job);

  deleteSelectedBrandContinuationTriggers_();
  deleteSelectedBrandWatchdogTriggers_();

  console.log(
    '[BRAND SELECTED] DONE' +
    ' | Rows=' + job.startRow + ':' + job.endRow +
    ' | Matched=' + job.matched +
    ' | Filled=' + job.filled +
    ' | Updated=' + job.updated +
    ' | Unresolved=' + job.unresolved +
    ' | NoSource=' + job.noSourceSkipped
  );

  /*
   * Nếu trước đó Full Scan/Pending đang chờ Selected xong,
   * cho background tiếp tục ngay sau khi Selected DONE.
   */
  try {
    const props = PropertiesService.getDocumentProperties();
    const rebuildActive =
      props.getProperty(
        brandPropertyKey_(
          SMART_BRAND_KEYS.REBUILD_ACTIVE
        )
      ) === '1';
    const pending = loadBrandPendingRanges_(props);

    if (
      rebuildActive ||
      (pending && pending.length)
    ) {
      scheduleBrandContinuation_();
    }
  } catch (resumeError) {
    console.log(
      '[BRAND SELECTED] Cannot resume background: ' +
      resumeError
    );
  }

  try {
    SpreadsheetApp
      .openById(job.spreadsheetId)
      .toast(
        'DONE rows ' +
        job.startRow + ':' + job.endRow +
        ' | Matched ' + job.matched +
        ' | Filled ' + job.filled +
        ' | Updated ' + job.updated +
        ' | Unresolved ' + job.unresolved,
        'BRAND SELECTED',
        9
      );
  } catch (error) {
    console.log(
      '[BRAND SELECTED] Finish toast error: ' +
      error
    );
  }
}


function loadSelectedBrandJob_() {
  const raw = PropertiesService.getDocumentProperties().getProperty(
    brandPropertyKey_(SMART_BRAND_KEYS.SELECTED_JOB)
  );
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}


function saveSelectedBrandJob_(job) {
  PropertiesService.getDocumentProperties().setProperty(
    brandPropertyKey_(SMART_BRAND_KEYS.SELECTED_JOB),
    JSON.stringify(job)
  );

  saveBrandLastActivity_({
    mode: 'SELECTED',
    status: job.status || 'RUNNING',
    phase: job.phase || '',
    startRow: Number(job.startRow) || 0,
    endRow: Number(job.endRow) || 0,
    currentRow: Number(job.cursor) || Number(job.startRow) || 0,
    lastSuccessRow: Number(job.lastSuccessRow) || 0,
    nextRow: Number(job.cursor) || 0,
    checked: Number(job.checked) || 0,
    matched: Number(job.matched) || 0,
    filled: Number(job.filled) || 0,
    updated: Number(job.updated) || 0,
    unresolved: Number(job.unresolved) || 0,
    skipped: Number(job.noSourceSkipped) || 0,
    errorPhase: job.errorPhase || '',
    errorRow: Number(job.errorRow) || 0,
    errorMessage: job.errorMessage || '',
    updatedAt: Number(job.updatedAt) || Date.now()
  });
}

function saveSelectedBrandJobIfCurrent_(job) {
  const current = loadSelectedBrandJob_();

  if (
    !current ||
    current.token !== job.token
  ) {
    return false;
  }

  const terminal = {
    DONE: true,
    ERROR: true,
    CANCELLED: true,
    CANCELLED_BY_FULL_RESET: true
  };

  if (
    terminal[current.status] &&
    !terminal[job.status]
  ) {
    return false;
  }

  saveSelectedBrandJob_(job);
  return true;
}



function scheduleSelectedBrandContinuation_() {
  const handler = SMART_BRAND_CONFIG.SELECTED_CONTINUE_HANDLER;
  const exists = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === handler;
  });
  if (exists) return;

  ScriptApp.newTrigger(handler)
    .timeBased()
    .after(SMART_BRAND_CONFIG.SELECTED_CONTINUE_AFTER_MS || 60000)
    .create();
}


function continueSelectedBrandUpdate_() {
  deleteSelectedBrandContinuationTriggers_();
  processSelectedBrandJob_();
}


function deleteSelectedBrandContinuationTriggers_() {
  const handler = SMART_BRAND_CONFIG.SELECTED_CONTINUE_HANDLER;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function scheduleSelectedBrandWatchdog_() {
  const handler =
    SMART_BRAND_CONFIG.SELECTED_WATCHDOG_HANDLER;

  const exists =
    ScriptApp
      .getProjectTriggers()
      .some(function(trigger) {
        return (
          trigger.getHandlerFunction() ===
          handler
        );
      });

  if (exists) {
    return;
  }

  ScriptApp
    .newTrigger(handler)
    .timeBased()
    .after(
      SMART_BRAND_CONFIG.SELECTED_WATCHDOG_AFTER_MS ||
      45000
    )
    .create();
}


function deleteSelectedBrandWatchdogTriggers_() {
  const handler =
    SMART_BRAND_CONFIG.SELECTED_WATCHDOG_HANDLER;

  ScriptApp
    .getProjectTriggers()
    .forEach(function(trigger) {
      if (
        trigger.getHandlerFunction() ===
        handler
      ) {
        ScriptApp.deleteTrigger(trigger);
      }
    });
}


function watchdogSelectedBrandUpdate_() {
  deleteSelectedBrandWatchdogTriggers_();

  const job = loadSelectedBrandJob_();

  if (
    !job ||
    job.status === 'DONE' ||
    job.status === 'ERROR' ||
    job.status === 'CANCELLED' ||
    job.status === 'CANCELLED_BY_FULL_RESET'
  ) {
    return;
  }

  const lease =
    getBrandExecutionLeaseState_();

  if (lease) {
    console.log(
      '[BRAND SELECTED WATCHDOG] Worker còn lease.' +
      ' Mode=' + lease.mode
    );
    scheduleSelectedBrandWatchdog_();
    return;
  }

  job.status = 'WAITING';
  job.phase = 'WATCHDOG_RESUME';
  job.updatedAt = Date.now();
  job.heartbeatAt = job.updatedAt;
  saveSelectedBrandJobIfCurrent_(job);

  console.log(
    '[BRAND SELECTED WATCHDOG] RESUME' +
    ' | Next=' + job.cursor
  );

  scheduleSelectedBrandContinuation_();
}



function brandFormatError_(error) {
  if (!error) return 'Unknown error';
  return String(error.stack || error.message || error).slice(0, 1200);
}


function brandShortError_(error) {
  return String((error && (error.message || error)) || 'Unknown error')
    .replace(/\s+/g, ' ')
    .slice(0, 180);
}


/***************************************************************
 * BRAND-SPECIFIC EXECUTION LEASE
 *
 * Apps Script không có named lock.
 * Ta dùng ScriptLock CHỈ trong vài ms để atomically quản lý
 * property lease riêng SMART_BRAND_EXECUTION_LEASE.
 *
 * Sau khi lấy lease, ScriptLock được thả ngay.
 * Vì vậy Brand không giữ DocumentLock 4 phút và không chặn
 * SEO / RQ Tech / Checked Date.
 ***************************************************************/
function acquireBrandExecutionLease_(
  mode,
  jobToken
) {
  const guard =
    LockService.getScriptLock();

  if (
    !guard.tryLock(
      SMART_BRAND_CONFIG.LEASE_LOCK_WAIT_MS
    )
  ) {
    return '';
  }

  try {
    const properties =
      PropertiesService.getDocumentProperties();

    const key =
      brandPropertyKey_(
        SMART_BRAND_KEYS.EXECUTION_LEASE
      );

    const now = Date.now();
    const raw =
      properties.getProperty(key);

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
        // Lease legacy/hỏng => ghi đè.
      }
    }

    const token =
      Utilities.getUuid() +
      '_' +
      now;

    properties.setProperty(
      key,
      JSON.stringify({
        token: token,
        mode: mode || 'BACKGROUND',
        jobToken: jobToken || '',
        startedAt: now,
        expiresAt:
          now +
          (
            Number(
              SMART_BRAND_CONFIG.EXECUTION_LEASE_MS
            ) ||
            480000
          )
      })
    );

    return token;

  } finally {
    guard.releaseLock();
  }
}


/***************************************************************
 * RELEASE BRAND-SPECIFIC LEASE
 ***************************************************************/
function releaseBrandExecutionLease_(
  token
) {

  if (!token) {
    return;
  }

  const guard = LockService.getScriptLock();

  if (
    !guard.tryLock(
      SMART_BRAND_CONFIG.LEASE_LOCK_WAIT_MS
    )
  ) {
    return;
  }

  try {

    const properties =
      PropertiesService.getDocumentProperties();

    const key = brandPropertyKey_(
      SMART_BRAND_KEYS.EXECUTION_LEASE
    );

    const raw = properties.getProperty(key);

    if (!raw) {
      return;
    }

    try {

      const current = JSON.parse(raw);

      if (
        current &&
        current.token === token
      ) {
        properties.deleteProperty(key);
      }

    } catch (error) {

      properties.deleteProperty(key);
    }

  } finally {

    guard.releaseLock();
  }
}

function getBrandExecutionLeaseState_() {
  const raw =
    PropertiesService
      .getDocumentProperties()
      .getProperty(
        brandPropertyKey_(
          SMART_BRAND_KEYS.EXECUTION_LEASE
        )
      );

  if (!raw) {
    return null;
  }

  try {
    const lease = JSON.parse(raw);

    if (
      !lease ||
      !lease.token ||
      Number(lease.expiresAt) <= Date.now()
    ) {
      return null;
    }

    return lease;
  } catch (error) {
    return null;
  }
}


function rememberBrandSpreadsheet_(ss) {
  if (!ss || !ss.getId) {
    return;
  }

  PropertiesService
    .getDocumentProperties()
    .setProperty(
      brandPropertyKey_(
        SMART_BRAND_KEYS.SPREADSHEET_ID
      ),
      ss.getId()
    );
}


function getBrandSpreadsheet_() {
  try {
    const active =
      SpreadsheetApp.getActiveSpreadsheet();

    if (active) {
      rememberBrandSpreadsheet_(active);
      return active;
    }
  } catch (error) {}

  const id =
    PropertiesService
      .getDocumentProperties()
      .getProperty(
        brandPropertyKey_(
          SMART_BRAND_KEYS.SPREADSHEET_ID
        )
      );

  if (!id) {
    return null;
  }

  return SpreadsheetApp.openById(id);
}


/***************************************************************
 * RULE CACHE INVALIDATION — V6
 *
 * Brand rules được cache để worker không phải đọc/compile lại.
 * Vì vậy phải clear cache NGAY khi SEO NAME RULE thay đổi.
 *
 * Trigger này là installable onEdit riêng của Brand.
 ***************************************************************/
function ensureBrandRuleInvalidationTrigger_(ss) {
  if (!ss) return;

  const handler =
    SMART_BRAND_CONFIG.RULE_CACHE_INVALIDATOR_HANDLER;

  const spreadsheetId = ss.getId();

  const matches =
    ScriptApp
      .getProjectTriggers()
      .filter(function(trigger) {
        return (
          trigger.getHandlerFunction() === handler &&
          (
            !trigger.getTriggerSourceId ||
            trigger.getTriggerSourceId() === spreadsheetId
          )
        );
      });

  if (!matches.length) {
    ScriptApp
      .newTrigger(handler)
      .forSpreadsheet(ss)
      .onEdit()
      .create();
  }

  // Chỉ giữ một trigger của handler này.
  for (let i = 1; i < matches.length; i++) {
    ScriptApp.deleteTrigger(matches[i]);
  }
}


function brandRuleCacheOnEdit_(e) {
  if (!e || !e.range) return;

  const sh = e.range.getSheet();

  if (
    !sh ||
    sh.getName() !== SMART_BRAND_CONFIG.RULE_SHEET
  ) {
    return;
  }

  const ss =
    e.source ||
    (
      sh.getParent
        ? sh.getParent()
        : null
    );

  if (ss) {
    rememberBrandSpreadsheet_(ss);
  }

  clearSmartBrandRuleCache_(sh);

  const props =
    PropertiesService.getDocumentProperties();

  props.deleteProperty(
    brandPropertyKey_(SMART_BRAND_KEYS.RULE_HASH)
  );

  props.deleteProperty(
    brandPropertyKey_(SMART_BRAND_KEYS.ACTIVE_RULE_HASH)
  );

  props.setProperty(
    brandPropertyKey_(SMART_BRAND_KEYS.REBUILD_ACTIVE),
    '1'
  );

  props.setProperty(
    brandPropertyKey_(SMART_BRAND_KEYS.REBUILD_CURSOR),
    String(SMART_BRAND_CONFIG.START_ROW)
  );

  const inputSheet =
    ss && ss.getSheetByName
      ? ss.getSheetByName(
          SMART_BRAND_CONFIG.INPUT_SHEET
        )
      : null;

  const lastRow =
    inputSheet
      ? getLastBrandSourceRow_(inputSheet)
      : 0;

  const state = {
    status: 'QUEUED',
    startRow: SMART_BRAND_CONFIG.START_ROW,
    endRow: lastRow,
    cursor: SMART_BRAND_CONFIG.START_ROW,
    currentRow: SMART_BRAND_CONFIG.START_ROW,
    lastSuccessRow: SMART_BRAND_CONFIG.START_ROW - 1,
    nextRow: SMART_BRAND_CONFIG.START_ROW,
    checked: 0,
    skipped: 0,
    detected: 0,
    unresolved: 0,
    changed: 0,
    startedAt: Date.now(),
    updatedAt: Date.now()
  };

  saveBrandJsonState_(
    SMART_BRAND_KEYS.FULL_SCAN_STATE,
    state
  );

  saveBrandLastActivity_(
    Object.assign(
      { mode: 'FULL_SCAN' },
      state
    )
  );

  resetBrandBackgroundRetry_();
  scheduleBrandContinuation_();
  scheduleBrandWatchdog_();

  console.log(
    '[BRAND RULES] DIRTY -> cache cleared + full rebuild queued.'
  );
}


/***************************************************************
 * TRANSIENT ERROR RETRY — V6
 ***************************************************************/
function isTransientBrandError_(error) {
  const message =
    String(
      error &&
      (
        error.message ||
        error
      ) ||
      ''
    )
      .toLowerCase();

  if (!message) {
    return false;
  }

  return (
    message.indexOf('service spreadsheets timed out') !== -1 ||
    message.indexOf('service spreadsheets failed') !== -1 ||
    message.indexOf('service invoked too many times') !== -1 ||
    message.indexOf('internal error') !== -1 ||
    message.indexOf('unexpected error') !== -1 ||
    message.indexOf('server error') !== -1 ||
    message.indexOf('temporarily unavailable') !== -1 ||
    message.indexOf('try again') !== -1 ||
    message.indexOf('timed out') !== -1 ||
    message.indexOf('timeout') !== -1
  );
}


function getBrandBackgroundRetry_() {
  return (
    Number(
      PropertiesService
        .getDocumentProperties()
        .getProperty(
          brandPropertyKey_(
            SMART_BRAND_KEYS.BACKGROUND_RETRY_COUNT
          )
        )
    ) || 0
  );
}


function incrementBrandBackgroundRetry_() {
  const next =
    getBrandBackgroundRetry_() + 1;

  PropertiesService
    .getDocumentProperties()
    .setProperty(
      brandPropertyKey_(
        SMART_BRAND_KEYS.BACKGROUND_RETRY_COUNT
      ),
      String(next)
    );

  return next;
}


function resetBrandBackgroundRetry_() {
  PropertiesService
    .getDocumentProperties()
    .deleteProperty(
      brandPropertyKey_(
        SMART_BRAND_KEYS.BACKGROUND_RETRY_COUNT
      )
    );
}


/***************************************************************
 * LAST BRAND SOURCE ROW — V6
 *
 * Không dùng INPUT.getLastRow() cho Full Scan vì các cột khác
 * có thể có dữ liệu/formula rất xa bên dưới.
 *
 * Brand chỉ phụ thuộc:
 * - C = Model K
 * - E = full SEO
 *
 * Lấy last row riêng của 2 source này rồi max().
 ***************************************************************/
function getLastBrandSourceRow_(sheet) {
  if (!sheet) {
    return SMART_BRAND_CONFIG.START_ROW - 1;
  }

  try {
    const maxRows = sheet.getMaxRows();
    let lastRow =
      SMART_BRAND_CONFIG.START_ROW - 1;

    const columns = [
      SMART_BRAND_CONFIG.MODEL_COL,
      SMART_BRAND_CONFIG.FULL_SEO_COL
    ];

    for (let i = 0; i < columns.length; i++) {
      const cell =
        sheet
          .getRange(
            maxRows,
            columns[i]
          )
          .getNextDataCell(
            SpreadsheetApp.Direction.UP
          );

      const row = cell.getRow();

      if (
        row >= SMART_BRAND_CONFIG.START_ROW &&
        String(
          cell.getDisplayValue() || ''
        ).trim() !== ''
      ) {
        lastRow = Math.max(
          lastRow,
          row
        );
      }
    }

    return lastRow;

  } catch (error) {
    // Fallback an toàn nếu spreadsheet service không hỗ trợ path trên.
    return Math.max(
      SMART_BRAND_CONFIG.START_ROW - 1,
      sheet.getLastRow()
    );
  }
}



/***************************************************************
 * CLEAR STALE BRAND LEASE — PUBLIC HELPER
 *
 * Chỉ cần chạy tay nếu trước đó Apps Script bị kill cứng
 * và muốn giải phóng lease ngay, không chờ lease tự hết hạn.
 ***************************************************************/
function clearBrandExecutionLease() {

  const guard = LockService.getScriptLock();

  guard.waitLock(
    SMART_BRAND_CONFIG.LEASE_LOCK_WAIT_MS
  );

  try {

    PropertiesService
      .getDocumentProperties()
      .deleteProperty(
        brandPropertyKey_(
          SMART_BRAND_KEYS.EXECUTION_LEASE
        )
      );

  } finally {

    guard.releaseLock();
  }

  console.log(
    '[BRAND] Đã clear Brand execution lease.'
  );
}


/***************************************************************
 * FULL REBUILD — PROCESS 1 BATCH
 ***************************************************************/
function processBrandRebuildBatch_(
  inputSheet,
  rules,
  properties,
  currentRuleHash,
  lastRow,
  startedAt
) {

  let cursor =
    Number(
      properties.getProperty(
        brandPropertyKey_(
          SMART_BRAND_KEYS.REBUILD_CURSOR
        )
      )
    ) ||
    SMART_BRAND_CONFIG.START_ROW;


  if (
    cursor <
    SMART_BRAND_CONFIG.START_ROW
  ) {

    cursor =
      SMART_BRAND_CONFIG.START_ROW;
  }


  // Đã xong rồi.
  if (
    cursor >
    lastRow
  ) {

    finishBrandRebuild_(
      properties,
      currentRuleHash,
      lastRow
    );

    return;
  }


  const endRow =
    Math.min(
      lastRow,
      cursor +
      SMART_BRAND_CONFIG.BATCH_SIZE -
      1
    );


  const stats =
    processBrandRange_(
      inputSheet,
      rules,
      cursor,
      endRow,
      true,
      startedAt
    );


  const actualEndRow =
    stats.processedRows > 0
      ? cursor + stats.processedRows - 1
      : cursor - 1;

  const nextRow =
    actualEndRow + 1;


  console.log(
    '[BRAND REBUILD]' +
    ' Rows=' + cursor + ':' + actualEndRow +
    ' | Checked=' + stats.checked +
    ' | Skipped=' + stats.skipped +
    ' | Detected=' + stats.detected +
    ' | Unresolved=' + stats.unresolved +
    ' | Changed=' + stats.changed
  );

  const previousFullState = loadBrandJsonState_(SMART_BRAND_KEYS.FULL_SCAN_STATE) || {};
  const fullProgressState = {
    status: nextRow <= lastRow ? 'RUNNING' : 'DONE',
    startRow: SMART_BRAND_CONFIG.START_ROW,
    endRow: lastRow,
    cursor: nextRow,
    currentRow: nextRow,
    lastSuccessRow: actualEndRow,
    nextRow: nextRow <= lastRow ? nextRow : SMART_BRAND_CONFIG.START_ROW,
    checked: (Number(previousFullState.checked) || 0) + (Number(stats.checked) || 0),
    skipped: (Number(previousFullState.skipped) || 0) + (Number(stats.skipped) || 0),
    detected: (Number(previousFullState.detected) || 0) + (Number(stats.detected) || 0),
    unresolved: (Number(previousFullState.unresolved) || 0) + (Number(stats.unresolved) || 0),
    changed: (Number(previousFullState.changed) || 0) + (Number(stats.changed) || 0),
    updatedAt: Date.now()
  };
  saveBrandJsonState_(SMART_BRAND_KEYS.FULL_SCAN_STATE, fullProgressState);
  saveBrandLastActivity_(Object.assign({ mode: 'FULL_SCAN' }, fullProgressState));


  if (
    nextRow <= lastRow
  ) {

    properties.setProperty(
      brandPropertyKey_(
        SMART_BRAND_KEYS.REBUILD_CURSOR
      ),
      String(nextRow)
    );

    scheduleBrandContinuation_();

  } else {

    finishBrandRebuild_(
      properties,
      currentRuleHash,
      lastRow
    );
  }
}


/***************************************************************
 * FINISH FULL REBUILD
 ***************************************************************/
function finishBrandRebuild_(
  properties,
  currentRuleHash,
  lastRow
) {

  properties.setProperty(
    brandPropertyKey_(
      SMART_BRAND_KEYS.RULE_HASH
    ),
    currentRuleHash
  );


  properties.setProperty(
    brandPropertyKey_(
      SMART_BRAND_KEYS.LAST_KNOWN_LAST_ROW
    ),
    String(lastRow)
  );


  properties.setProperty(
    brandPropertyKey_(
      SMART_BRAND_KEYS.SCAN_CURSOR
    ),
    String(
      SMART_BRAND_CONFIG.START_ROW
    )
  );


  properties.deleteProperty(
    brandPropertyKey_(
      SMART_BRAND_KEYS.REBUILD_ACTIVE
    )
  );


  properties.deleteProperty(
    brandPropertyKey_(
      SMART_BRAND_KEYS.REBUILD_CURSOR
    )
  );


  properties.deleteProperty(
    brandPropertyKey_(
      SMART_BRAND_KEYS.ACTIVE_RULE_HASH
    )
  );


  properties.deleteProperty(
    brandPropertyKey_(SMART_BRAND_KEYS.LAST_ERROR)
  );

  const previousFullState = loadBrandJsonState_(SMART_BRAND_KEYS.FULL_SCAN_STATE) || {};
  const doneFullState = {
    status: 'DONE',
    startRow: SMART_BRAND_CONFIG.START_ROW,
    endRow: lastRow,
    cursor: lastRow + 1,
    currentRow: lastRow + 1,
    lastSuccessRow: lastRow,
    nextRow: SMART_BRAND_CONFIG.START_ROW,
    checked: Number(previousFullState.checked) || 0,
    skipped: Number(previousFullState.skipped) || 0,
    detected: Number(previousFullState.detected) || 0,
    unresolved: Number(previousFullState.unresolved) || 0,
    changed: Number(previousFullState.changed) || 0,
    updatedAt: Date.now()
  };
  saveBrandJsonState_(SMART_BRAND_KEYS.FULL_SCAN_STATE, doneFullState);
  saveBrandLastActivity_(Object.assign({ mode: 'FULL_SCAN' }, doneFullState));


  console.log(
    '[BRAND] Full rebuild hoàn tất tới row ' +
    lastRow +
    '.'
  );
}


/***************************************************************
 * PENDING — PROCESS 1 BATCH
 ***************************************************************/
function processBrandPendingBatch_(
  inputSheet,
  rules,
  properties,
  pendingRanges,
  startedAt
) {

  let ranges =
    mergeBrandRanges_(
      pendingRanges
    );


  if (!ranges.length) {

    saveBrandPendingRanges_(
      properties,
      []
    );

    return;
  }


  const lastRow =
    inputSheet.getLastRow();


  let startRow =
    Math.max(
      SMART_BRAND_CONFIG.START_ROW,
      Number(
        ranges[0][0]
      ) ||
      SMART_BRAND_CONFIG.START_ROW
    );


  let endRow =
    Math.min(
      lastRow,
      Number(
        ranges[0][1]
      ) ||
      startRow
    );


  // Range không còn hợp lệ.
  if (
    startRow >
    endRow
  ) {

    ranges.shift();


    saveBrandPendingRanges_(
      properties,
      ranges
    );


    if (
      ranges.length
    ) {

      scheduleBrandContinuation_();
    }


    return;
  }


  const batchEnd =
    Math.min(
      endRow,
      startRow +
      SMART_BRAND_CONFIG.BATCH_SIZE -
      1
    );


  const stats =
    processBrandRange_(
      inputSheet,
      rules,
      startRow,
      batchEnd,
      false,
      startedAt
    );


  const actualBatchEnd =
    stats.processedRows > 0
      ? startRow + stats.processedRows - 1
      : startRow - 1;

  console.log(
    '[BRAND PENDING]' +
    ' Rows=' + startRow + ':' + actualBatchEnd +
    ' | Checked=' + stats.checked +
    ' | Skipped=' + stats.skipped +
    ' | Detected=' + stats.detected +
    ' | Unresolved=' + stats.unresolved +
    ' | Changed=' + stats.changed
  );

  const pendingBatchStats = {
    startRow: startRow,
    endRow: endRow,
    lastSuccessRow: actualBatchEnd,
    checked: Number(stats.checked) || 0,
    skipped: Number(stats.skipped) || 0,
    detected: Number(stats.detected) || 0,
    unresolved: Number(stats.unresolved) || 0,
    changed: Number(stats.changed) || 0
  };


  if (
    actualBatchEnd <
    endRow
  ) {

    ranges[0] = [
      Math.max(startRow, actualBatchEnd + 1),
      endRow
    ];

  } else {

    ranges.shift();
  }


  saveBrandPendingRanges_(
    properties,
    ranges
  );

  const pendingNextRow = ranges.length
    ? Number(ranges[0][0]) || SMART_BRAND_CONFIG.START_ROW
    : 0;
  const pendingState = Object.assign({}, pendingBatchStats, {
    status: ranges.length ? 'RUNNING' : 'DONE',
    currentRow: pendingNextRow || (actualBatchEnd + 1),
    nextRow: pendingNextRow,
    updatedAt: Date.now()
  });
  saveBrandJsonState_(SMART_BRAND_KEYS.PENDING_STATE, pendingState);
  saveBrandLastActivity_(Object.assign({ mode: 'PENDING' }, pendingState));


  if (
    ranges.length
  ) {

    scheduleBrandContinuation_();
  }
}


/***************************************************************
 * ROLLING SCAN — PROCESS 1 BATCH
 *
 * Không quét lại toàn bộ trong 1 execution.
 *
 * Mỗi lần chạy:
 * - đọc 1 batch
 * - so fingerprint
 * - Brand có + fingerprint không đổi => skip
 * - Brand trống / source đổi => detect
 ***************************************************************/
function processBrandRollingBatch_(
  inputSheet,
  rules,
  properties,
  lastRow,
  startedAt
) {

  let cursor =
    Number(
      properties.getProperty(
        brandPropertyKey_(
          SMART_BRAND_KEYS.SCAN_CURSOR
        )
      )
    ) ||
    SMART_BRAND_CONFIG.START_ROW;


  if (
    cursor <
      SMART_BRAND_CONFIG.START_ROW ||
    cursor >
      lastRow
  ) {

    cursor =
      SMART_BRAND_CONFIG.START_ROW;
  }


  const endRow =
    Math.min(
      lastRow,
      cursor +
      SMART_BRAND_CONFIG.BATCH_SIZE -
      1
    );


  const stats =
    processBrandRange_(
      inputSheet,
      rules,
      cursor,
      endRow,
      false,
      startedAt
    );


  const actualEndRow =
    stats.processedRows > 0
      ? cursor + stats.processedRows - 1
      : cursor - 1;

  let nextRow =
    actualEndRow + 1;


  if (
    nextRow >
    lastRow
  ) {

    nextRow =
      SMART_BRAND_CONFIG.START_ROW;
  }


  properties.setProperty(
    brandPropertyKey_(
      SMART_BRAND_KEYS.SCAN_CURSOR
    ),
    String(nextRow)
  );


  properties.setProperty(
    brandPropertyKey_(
      SMART_BRAND_KEYS.LAST_KNOWN_LAST_ROW
    ),
    String(lastRow)
  );

  const rollingState = {
    status: 'DONE',
    startRow: cursor,
    endRow: endRow,
    currentRow: nextRow,
    lastSuccessRow: actualEndRow,
    nextRow: nextRow,
    sheetLastRow: lastRow,
    checked: Number(stats.checked) || 0,
    skipped: Number(stats.skipped) || 0,
    detected: Number(stats.detected) || 0,
    unresolved: Number(stats.unresolved) || 0,
    changed: Number(stats.changed) || 0,
    updatedAt: Date.now()
  };
  saveBrandJsonState_(SMART_BRAND_KEYS.ROLLING_STATE, rollingState);
  saveBrandLastActivity_(Object.assign({ mode: 'ROLLING' }, rollingState));


  console.log(
    '[BRAND SCAN]' +
    ' Rows=' + cursor + ':' + actualEndRow +
    ' | Checked=' + stats.checked +
    ' | Skipped=' + stats.skipped +
    ' | Detected=' + stats.detected +
    ' | Unresolved=' + stats.unresolved +
    ' | Changed=' + stats.changed +
    ' | Next=' + nextRow
  );
}


/***************************************************************
 * CORE — PROCESS 1 RANGE
 ***************************************************************/
function processBrandRange_(
  inputSheet,
  rules,
  startRow,
  endRow,
  forceDetect,
  startedAt
) {
  const numRows =
    endRow - startRow + 1;

  if (numRows <= 0) {
    return {
      checked: 0,
      skipped: 0,
      detected: 0,
      unresolved: 0,
      changed: 0,
      cleared: 0,
      processedRows: 0
    };
  }

  const data =
    inputSheet
      .getRange(
        startRow,
        SMART_BRAND_CONFIG.BRAND_COL,
        numRows,
        SMART_BRAND_CONFIG.FULL_SEO_COL -
          SMART_BRAND_CONFIG.BRAND_COL +
          1
      )
      .getDisplayValues();

  const startIndex =
    startRow -
    SMART_BRAND_CONFIG.START_ROW;

  const oldCache =
    loadSmartBrandCacheSlice_(
      startIndex,
      numRows
    );

  const newCache =
    new Array(numRows);

  const outputBrands =
    new Array(numRows);

  const changedLocalIndexes = [];
  const memo = Object.create(null);

  let checked = 0;
  let skipped = 0;
  let detected = 0;
  let unresolved = 0;
  let changed = 0;
  let cleared = 0;
  let processedRows = 0;

  const safeRuntime =
    Number(
      SMART_BRAND_CONFIG.MAX_RUNTIME_MS
    ) || 18000;

  for (let i = 0; i < numRows; i++) {
    if (
      i > 0 &&
      Date.now() - startedAt >= safeRuntime
    ) {
      break;
    }

    const currentBrand =
      cleanString_(data[i][0]);

    const modelK =
      cleanString_(data[i][1]);

    const fullSEO =
      cleanString_(data[i][3]);

    const fingerprint =
      createBrandFingerprint_(
        modelK,
        fullSEO
      );

    const oldFingerprint =
      oldCache[i] || '';

    processedRows++;

    if (!modelK && !fullSEO) {
      outputBrands[i] = [currentBrand];
      newCache[i] = fingerprint;
      skipped++;
      continue;
    }

    const needCheck =
      forceDetect ||
      currentBrand === '' ||
      oldFingerprint === '' ||
      oldFingerprint !== fingerprint;

    if (!needCheck) {
      outputBrands[i] = [currentBrand];
      newCache[i] = fingerprint;
      skipped++;
      continue;
    }

    checked++;

    const memoKey =
      modelK +
      '\u0001' +
      fullSEO;

    let result = memo[memoKey];

    if (!result) {
      result = detectSmartBrand_(
        modelK,
        fullSEO,
        rules
      );
      memo[memoKey] = result;
    }

    const newBrand =
      result.brand || '';

    newCache[i] = fingerprint;

    if (!newBrand) {
      outputBrands[i] = [currentBrand];
      unresolved++;
      continue;
    }

    outputBrands[i] = [newBrand];
    detected++;

    if (newBrand !== currentBrand) {
      changedLocalIndexes.push(i);
      changed++;
    }
  }

  /*
   * Chỉ giữ changed index nằm trong phần đã xử lý.
   */
  writeBrandRangeChanges_(
    inputSheet,
    startRow,
    outputBrands,
    changedLocalIndexes
  );

  /*
   * Chỉ save fingerprint của phần đã xử lý.
   * Bản cũ save cả numRows khi dừng sớm => có thể ghi blank cache
   * cho phần chưa xử lý.
   */
  if (processedRows > 0) {
    saveSmartBrandCacheSlice_(
      startIndex,
      newCache.slice(0, processedRows)
    );
  }

  return {
    checked: checked,
    skipped: skipped,
    detected: detected,
    unresolved: unresolved,
    changed: changed,
    cleared: cleared,
    processedRows: processedRows
  };
}


/***************************************************************
 * LOAD BRAND RULE
 *
 * GIỮ NGUYÊN TÊN HÀM CŨ.
 ***************************************************************/
function loadSmartBrandRules_(sheet, forceReload) {
  const startedAt = Date.now();

  if (!sheet) {
    throw new Error('loadSmartBrandRules_: rule sheet không hợp lệ.');
  }

  if (!forceReload) {
    const cached = loadSmartBrandRulesCache_(sheet);
    if (cached && cached.rules && cached.rules.length) {
      console.log(
        '[BRAND RULES] SOURCE=CACHE' +
        ' | Rules=' + cached.rules.length +
        ' | Hash=' + cached.hash +
        ' | ' + (Date.now() - startedAt) + 'ms'
      );
      return cached;
    }
  }

  const data = readSmartBrandRulesFromSheet_(sheet);

  saveSmartBrandRulesCache_(sheet, data);

  console.log(
    '[BRAND RULES] SOURCE=SHEET' +
    ' | Rules=' + data.rules.length +
    ' | Hash=' + data.hash +
    ' | ' + (Date.now() - startedAt) + 'ms'
  );

  return data;
}




/***************************************************************
 * BRAND RULE CACHE / RAW LOAD — V6
 ***************************************************************/
function readSmartBrandRulesFromSheet_(sheet) {
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return { rules: [], hash: 'V6_EMPTY' };
  }

  const values = sheet
    .getRange(2, 1, lastRow - 1, 5)
    .getDisplayValues();

  const rules = [];
  let h1 = 2166136261 >>> 0;
  let h2 = 2246822519 >>> 0;

  function mixHash_(text) {
    text = String(text || '');
    for (let j = 0; j < text.length; j++) {
      const cc = text.charCodeAt(j);
      h1 ^= cc;
      h1 = Math.imul(h1, 16777619) >>> 0;
      h2 ^= (cc + 97);
      h2 = Math.imul(h2, 3266489917) >>> 0;
    }
    h1 ^= 10;
    h2 ^= 13;
  }

  for (let i = 0; i < values.length; i++) {
    const row = values[i];

    const key = cleanString_(row[0]);
    const seoName = cleanString_(row[1]);
    const type = (cleanString_(row[2]) || 'exact').toLowerCase();
    const brand = cleanString_(row[3]);

    let priority = parseInt(row[4], 10);
    if (!Number.isFinite(priority)) {
      priority = 9;
    }

    mixHash_(
      key + '\u0001' +
      seoName + '\u0001' +
      type + '\u0001' +
      brand + '\u0001' +
      priority
    );

    if (!brand) {
      continue;
    }

    if (key) {
      const keyRule = createSmartBrandRule_(
        key,
        type,
        brand,
        priority,
        i + 2,
        'KEY'
      );
      if (keyRule) {
        rules.push(keyRule);
      }
    }

    if (
      seoName &&
      normalizeBrandText_(seoName) !== normalizeBrandText_(key)
    ) {
      const seoRule = createSmartBrandRule_(
        seoName,
        type,
        brand,
        priority,
        i + 2,
        'SEO_NAME'
      );
      if (seoRule) {
        rules.push(seoRule);
      }
    }
  }

  rules.sort(function(a, b) {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    if (a.tokenLength !== b.tokenLength) {
      return b.tokenLength - a.tokenLength;
    }
    if (a.textLength !== b.textLength) {
      return b.textLength - a.textLength;
    }
    return a.row - b.row;
  });

  for (let i = 0; i < rules.length; i++) {
    rules[i].rank = i;
  }

  return {
    rules: rules,
    hash:
      'V6_' +
      (h1 >>> 0).toString(36) +
      '_' +
      (h2 >>> 0).toString(36) +
      '_' +
      values.length +
      '_' +
      rules.length
  };
}


function smartBrandRuleCachePrefix_(sheet) {
  return (
    'SMART_BRAND_RULE_CACHE_' +
    SMART_BRAND_CONFIG.RULE_CACHE_VERSION +
    '_' +
    sheet.getSheetId()
  );
}


function loadSmartBrandRulesCache_(sheet) {
  const cache = CacheService.getDocumentCache();
  const prefix = smartBrandRuleCachePrefix_(sheet);
  const metaRaw = cache.get(prefix + '_META');

  if (!metaRaw) {
    return null;
  }

  let meta;
  try {
    meta = JSON.parse(metaRaw);
  } catch (error) {
    return null;
  }

  const chunks = Number(meta.chunks) || 0;
  if (chunks < 1) {
    return null;
  }

  let json = '';

  for (let i = 0; i < chunks; i++) {
    const part = cache.get(prefix + '_CHUNK_' + i);
    if (part === null || part === undefined) {
      return null;
    }
    json += part;
  }

  try {
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.rules)) {
      return null;
    }

    for (let i = 0; i < parsed.rules.length; i++) {
      parsed.rules[i].rank = i;
    }

    return parsed;
  } catch (error) {
    console.log('[BRAND RULES] Cache parse error: ' + error);
    return null;
  }
}


function saveSmartBrandRulesCache_(sheet, data) {
  try {
    const cache = CacheService.getDocumentCache();
    const prefix = smartBrandRuleCachePrefix_(sheet);
    const seconds = Number(SMART_BRAND_CONFIG.RULE_CACHE_SECONDS) || 600;
    const chunkChars = Number(SMART_BRAND_CONFIG.RULE_CACHE_CHUNK_CHARS) || 50000;

    const payload = JSON.stringify({
      hash: data.hash || '',
      rules: data.rules || []
    });

    const chunks = Math.max(1, Math.ceil(payload.length / chunkChars));

    for (let i = 0; i < chunks; i++) {
      cache.put(
        prefix + '_CHUNK_' + i,
        payload.slice(i * chunkChars, (i + 1) * chunkChars),
        seconds
      );
    }

    cache.put(
      prefix + '_META',
      JSON.stringify({
        chunks: chunks,
        chars: payload.length,
        savedAt: Date.now()
      }),
      seconds
    );
  } catch (error) {
    console.log('[BRAND RULES] Cannot save cache: ' + error);
  }
}


function clearSmartBrandRuleCache_(sheet) {
  if (!sheet) {
    return;
  }

  try {
    const cache = CacheService.getDocumentCache();
    const prefix = smartBrandRuleCachePrefix_(sheet);
    const metaRaw = cache.get(prefix + '_META');
    let chunks = 0;

    if (metaRaw) {
      try {
        chunks = Number(JSON.parse(metaRaw).chunks) || 0;
      } catch (error) {}
    }

    cache.remove(prefix + '_META');

    for (let i = 0; i < chunks; i++) {
      cache.remove(prefix + '_CHUNK_' + i);
    }
  } catch (error) {
    console.log('[BRAND RULES] Cannot clear cache: ' + error);
  }
}


function compileSmartBrandRuleIndex_(rules) {
  if (!rules || !rules.length) {
    return {
      exactFirst: Object.create(null),
      prefixFirstChar: Object.create(null)
    };
  }

  if (rules.__smartBrandIndexV6) {
    return rules.__smartBrandIndexV6;
  }

  const exactFirst = Object.create(null);
  const prefixFirstChar = Object.create(null);

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const normalized = String(rule.normalized || '');
    if (!normalized) continue;

    const firstToken = normalized.split(' ')[0];

    if (
      rule.type === 'prefix' &&
      normalized.indexOf(' ') === -1
    ) {
      const firstChar = firstToken.charAt(0);
      if (!prefixFirstChar[firstChar]) {
        prefixFirstChar[firstChar] = [];
      }
      prefixFirstChar[firstChar].push(i);
    } else {
      if (!exactFirst[firstToken]) {
        exactFirst[firstToken] = [];
      }
      exactFirst[firstToken].push(i);
    }
  }

  const index = {
    exactFirst: exactFirst,
    prefixFirstChar: prefixFirstChar
  };

  try {
    Object.defineProperty(
      rules,
      '__smartBrandIndexV6',
      {
        value: index,
        enumerable: false
      }
    );
  } catch (error) {
    rules.__smartBrandIndexV6 = index;
  }

  return index;
}

/***************************************************************
 * CREATE RULE
 *
 * GIỮ NGUYÊN TÊN HÀM CŨ.
 ***************************************************************/
function createSmartBrandRule_(
  text,
  type,
  brand,
  priority,
  row,
  source
) {
  const normalized = normalizeBrandText_(text);

  if (!normalized) {
    return null;
  }

  /*
   * V6: KHÔNG build RegExp cho từng rule.
   * Detection mới dùng index + string boundary nên regex này chỉ còn
   * là helper tương thích nếu code cũ gọi buildSmartBrandRegex_ riêng.
   */
  return {
    original: text,
    normalized: normalized,
    type: String(type || 'exact').toLowerCase(),
    brand: brand,
    priority: priority,
    row: row,
    source: source,
    textLength: normalized.length,
    tokenLength: normalized.split(' ').length
  };
}


/***************************************************************
 * DETECT BRAND
 *
 * GIỮ NGUYÊN TÊN HÀM CŨ.
 *
 * Collab:
 *
 * SUP x AM Plus TN
 *
 * SUP = P2
 * AM  = P1
 *
 * Rules đã sort => AM/NK thắng.
 ***************************************************************/
function detectSmartBrand_(
  modelK,
  fullSEO,
  rules
) {
  const model = normalizeBrandText_(modelK);
  const seo = normalizeBrandText_(fullSEO);

  const combined = (model + ' ' + seo)
    .replace(/\s+/g, ' ')
    .trim();

  if (!combined || !rules || !rules.length) {
    return {
      brand: '',
      rule: null
    };
  }

  const index = compileSmartBrandRuleIndex_(rules);
  const tokens = combined.split(' ');
  const candidates = Object.create(null);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;

    const exact = index.exactFirst[token];
    if (exact) {
      for (let j = 0; j < exact.length; j++) {
        candidates[exact[j]] = 1;
      }
    }

    const prefix = index.prefixFirstChar[token.charAt(0)];
    if (prefix) {
      for (let j = 0; j < prefix.length; j++) {
        candidates[prefix[j]] = 1;
      }
    }
  }

  const ranks = Object.keys(candidates)
    .map(function(value) {
      return Number(value);
    })
    .sort(function(a, b) {
      return a - b;
    });

  for (let i = 0; i < ranks.length; i++) {
    const rule = rules[ranks[i]];

    if (smartBrandRuleMatchesFast_(combined, rule)) {
      return {
        brand: rule.brand,
        rule: rule
      };
    }
  }

  return {
    brand: '',
    rule: null
  };
}


function smartBrandRuleMatchesFast_(combined, rule) {
  const needle = rule && rule.normalized
    ? String(rule.normalized)
    : '';

  if (!needle) {
    return false;
  }

  // EXACT: phrase phải có boundary space/start/end đúng như regex cũ.
  if (rule.type !== 'prefix') {
    return (' ' + combined + ' ').indexOf(' ' + needle + ' ') !== -1;
  }

  // PREFIX: tìm từng occurrence và kiểm tra boundary trước/sau.
  let fromIndex = 0;

  while (fromIndex <= combined.length - needle.length) {
    const found = combined.indexOf(needle, fromIndex);
    if (found === -1) {
      return false;
    }

    const beforeOk = found === 0 || combined.charAt(found - 1) === ' ';

    if (beforeOk) {
      const afterIndex = found + needle.length;

      // Prefix ở cuối chuỗi luôn hợp lệ.
      if (afterIndex >= combined.length) {
        return true;
      }

      const afterChar = combined.charAt(afterIndex);

      if (needle.length === 1) {
        // Rule 1 ký tự như J: chỉ match J + số (hoặc J ở cuối),
        // tránh J Balvin => Jordan Balvin.
        let p = afterIndex;
        while (p < combined.length && combined.charAt(p) === ' ') {
          p++;
        }

        if (p < combined.length && /[0-9]/.test(combined.charAt(p))) {
          return true;
        }
      } else {
        // Rule >=2 ký tự: AJ4 / AJ 4 / DM Molly đều hợp lệ.
        if (afterChar === ' ' || /[0-9]/.test(afterChar)) {
          return true;
        }
      }
    }

    fromIndex = found + 1;
  }

  return false;
}


/***************************************************************
 * BUILD REGEX
 *
 * GIỮ NGUYÊN TÊN HÀM CŨ.
 ***************************************************************/
function buildSmartBrandRegex_(
  normalized,
  type
) {

  const escaped =
    escapeSmartRegex_(
      normalized
    )
      .replace(
        /\s+/g,
        '\\s+'
      );


  // ===========================================================
  // PREFIX
  // ===========================================================
  if (
    type ===
    'prefix'
  ) {

    /*
     * KEY 1 ký tự như J:
     *
     * J Balvin
     *
     * KHÔNG được hiểu J = Jordan.
     *
     * Chỉ match J nếu sau J là số hoặc end.
     */
    if (
      normalized.length === 1
    ) {

      return new RegExp(
        '(?:^|\\s)' +
        escaped +
        '(?=\\s*\\d|$)',
        'i'
      );
    }


    /*
     * AJ prefix match:
     *
     * AJ 4
     * AJ4
     *
     * Không match một từ chứa AJ ở giữa.
     */
    return new RegExp(
      '(?:^|\\s)' +
      escaped +
      '(?=\\s|\\d|$)',
      'i'
    );
  }


  // ===========================================================
  // EXACT
  // ===========================================================
  return new RegExp(
    '(?:^|\\s)' +
    escaped +
    '(?=\\s|$)',
    'i'
  );
}


/***************************************************************
 * NORMALIZE
 *
 * GIỮ NGUYÊN TÊN HÀM CŨ.
 ***************************************************************/
function normalizeBrandText_(
  value
) {

  return String(
    value ||
    ''
  )

    .normalize(
      'NFD'
    )

    .replace(
      /[\u0300-\u036f]/g,
      ''
    )

    .replace(
      /\u00A0/g,
      ' '
    )

    .replace(
      /[’‘`´]/g,
      "'"
    )

    .toUpperCase()

    .replace(
      /[^A-Z0-9]+/g,
      ' '
    )

    .replace(
      /\s+/g,
      ' '
    )

    .trim();
}


/***************************************************************
 * FINGERPRINT
 *
 * GIỮ NGUYÊN TÊN HÀM CŨ.
 *
 * Bản cũ:
 * - MD5 cho TỪNG DÒNG.
 *
 * Bản mới:
 * - hash JS nhẹ.
 *
 * Vẫn giữ đúng mục đích:
 * Model K/full SEO đổi => fingerprint đổi.
 ***************************************************************/
function createBrandFingerprint_(
  modelK,
  fullSEO
) {

  const text =
    normalizeBrandText_(
      modelK
    ) +
    '|' +
    normalizeBrandText_(
      fullSEO
    );


  return fastBrandHash_(
    text
  );
}


/***************************************************************
 * MD5 STRING
 *
 * GIỮ NGUYÊN HÀM CŨ
 * vì có thể code khác đang gọi hàm này.
 *
 * Brand fingerprint không còn gọi MD5 từng dòng nữa.
 ***************************************************************/
function md5String_(
  text
) {

  const digest =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.MD5,
      String(
        text ||
        ''
      ),
      Utilities.Charset.UTF_8
    );


  return digest
    .map(
      function(byte) {

        const value =
          (
            byte < 0
          )
            ? byte + 256
            : byte;


        return (
          '0' +
          value.toString(16)
        )
          .slice(-2);
      }
    )
    .join('');
}


/***************************************************************
 * FAST HASH
 *
 * Chỉ dùng cho fingerprint từng dòng.
 ***************************************************************/
function fastBrandHash_(
  text
) {

  text =
    String(
      text ||
      ''
    );


  let hash =
    2166136261;


  for (
    let i = 0;
    i < text.length;
    i++
  ) {

    hash ^=
      text.charCodeAt(i);


    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }


  return (
    hash >>> 0
  )
    .toString(36);
}


/***************************************************************
 * LOAD CACHE
 *
 * GIỮ NGUYÊN TÊN + CHỨC NĂNG CŨ:
 * loadSmartBrandCache_(numRows)
 *
 * Hàm này vẫn có thể load toàn bộ cache nếu code khác gọi.
 *
 * smartUpdateBrands mới KHÔNG dùng cách load full này nữa.
 * Nó chỉ load slice của batch.
 ***************************************************************/
function loadSmartBrandCache_(
  numRows
) {

  const result =
    new Array(
      numRows
    )
      .fill('');


  const chunkSize =
    SMART_BRAND_CONFIG.CACHE_CHUNK_SIZE;


  const chunks =
    Math.ceil(
      numRows /
      chunkSize
    );


  const properties =
    PropertiesService
      .getDocumentProperties();


  for (
    let c = 0;
    c < chunks;
    c++
  ) {

    const key =
      SMART_BRAND_CONFIG.PROPERTY_PREFIX +
      'CACHE_' +
      c;


    const raw =
      properties.getProperty(
        key
      );


    if (
      !raw
    ) {

      continue;
    }


    try {

      const values =
        JSON.parse(
          raw
        );


      const start =
        c *
        chunkSize;


      for (
        let i = 0;
        i < values.length;
        i++
      ) {

        const index =
          start + i;


        if (
          index >=
          numRows
        ) {

          break;
        }


        result[index] =
          values[i] ||
          '';
      }

    } catch (error) {

      console.log(
        '[BRAND] Cache parse error ' +
        key +
        ': ' +
        error
      );
    }
  }


  return result;
}


/***************************************************************
 * SAVE CACHE
 *
 * GIỮ NGUYÊN TÊN + CHỨC NĂNG CŨ:
 * saveSmartBrandCache_(cache)
 *
 * Có thể save toàn bộ nếu code khác đang gọi.
 ***************************************************************/
function saveSmartBrandCache_(
  cache
) {

  const properties =
    PropertiesService
      .getDocumentProperties();


  const chunkSize =
    SMART_BRAND_CONFIG.CACHE_CHUNK_SIZE;


  const chunks =
    Math.ceil(
      cache.length /
      chunkSize
    );


  for (
    let c = 0;
    c < chunks;
    c++
  ) {

    const start =
      c *
      chunkSize;


    const end =
      Math.min(
        start +
        chunkSize,
        cache.length
      );


    const values =
      cache.slice(
        start,
        end
      );


    const key =
      SMART_BRAND_CONFIG.PROPERTY_PREFIX +
      'CACHE_' +
      c;


    properties.setProperty(
      key,
      JSON.stringify(
        values
      )
    );
  }


  const countKey =
    SMART_BRAND_CONFIG.PROPERTY_PREFIX +
    'CACHE_COUNT';


  const oldCount =
    Number(
      properties.getProperty(
        countKey
      )
    ) ||
    0;


  properties.setProperty(
    countKey,
    String(
      chunks
    )
  );


  if (
    oldCount >
    chunks
  ) {

    for (
      let c = chunks;
      c < oldCount;
      c++
    ) {

      properties.deleteProperty(
        SMART_BRAND_CONFIG.PROPERTY_PREFIX +
        'CACHE_' +
        c
      );
    }
  }
}


/***************************************************************
 * LOAD CACHE SLICE
 *
 * Chỉ đọc những chunk liên quan tới batch hiện tại.
 ***************************************************************/
function loadSmartBrandCacheSlice_(
  startIndex,
  count
) {

  const result =
    new Array(
      count
    )
      .fill('');


  if (
    count <= 0
  ) {

    return result;
  }


  const chunkSize =
    SMART_BRAND_CONFIG.CACHE_CHUNK_SIZE;


  const firstChunk =
    Math.floor(
      startIndex /
      chunkSize
    );


  const lastGlobalIndex =
    startIndex +
    count -
    1;


  const lastChunk =
    Math.floor(
      lastGlobalIndex /
      chunkSize
    );


  const properties =
    PropertiesService
      .getDocumentProperties();


  for (
    let chunk = firstChunk;
    chunk <= lastChunk;
    chunk++
  ) {

    const key =
      SMART_BRAND_CONFIG.PROPERTY_PREFIX +
      'CACHE_' +
      chunk;


    const raw =
      properties.getProperty(
        key
      );


    if (
      !raw
    ) {

      continue;
    }


    let values = [];


    try {

      values =
        JSON.parse(
          raw
        );


      if (
        !Array.isArray(
          values
        )
      ) {

        values = [];
      }

    } catch (error) {

      console.log(
        '[BRAND] Cache slice parse error ' +
        key +
        ': ' +
        error
      );

      values = [];
    }


    const chunkGlobalStart =
      chunk *
      chunkSize;


    const overlapStart =
      Math.max(
        startIndex,
        chunkGlobalStart
      );


    const overlapEnd =
      Math.min(
        lastGlobalIndex,
        chunkGlobalStart +
        chunkSize -
        1
      );


    for (
      let globalIndex = overlapStart;
      globalIndex <= overlapEnd;
      globalIndex++
    ) {

      const localResultIndex =
        globalIndex -
        startIndex;


      const localChunkIndex =
        globalIndex -
        chunkGlobalStart;


      result[localResultIndex] =
        values[localChunkIndex] ||
        '';
    }
  }


  return result;
}


/***************************************************************
 * SAVE CACHE SLICE
 *
 * Chỉ rewrite những chunk batch chạm tới.
 ***************************************************************/
function saveSmartBrandCacheSlice_(
  startIndex,
  valuesToSave
) {

  if (
    !valuesToSave ||
    !valuesToSave.length
  ) {

    return;
  }


  const chunkSize =
    SMART_BRAND_CONFIG.CACHE_CHUNK_SIZE;


  const firstChunk =
    Math.floor(
      startIndex /
      chunkSize
    );


  const lastGlobalIndex =
    startIndex +
    valuesToSave.length -
    1;


  const lastChunk =
    Math.floor(
      lastGlobalIndex /
      chunkSize
    );


  const properties =
    PropertiesService
      .getDocumentProperties();


  for (
    let chunk = firstChunk;
    chunk <= lastChunk;
    chunk++
  ) {

    const key =
      SMART_BRAND_CONFIG.PROPERTY_PREFIX +
      'CACHE_' +
      chunk;


    let chunkValues =
      new Array(
        chunkSize
      )
        .fill('');


    const raw =
      properties.getProperty(
        key
      );


    if (
      raw
    ) {

      try {

        const parsed =
          JSON.parse(
            raw
          );


        if (
          Array.isArray(
            parsed
          )
        ) {

          for (
            let i = 0;
            i < Math.min(
              parsed.length,
              chunkSize
            );
            i++
          ) {

            chunkValues[i] =
              parsed[i] ||
              '';
          }
        }

      } catch (error) {

        console.log(
          '[BRAND] Cache slice existing parse error ' +
          key +
          ': ' +
          error
        );
      }
    }


    const chunkGlobalStart =
      chunk *
      chunkSize;


    const overlapStart =
      Math.max(
        startIndex,
        chunkGlobalStart
      );


    const overlapEnd =
      Math.min(
        lastGlobalIndex,
        chunkGlobalStart +
        chunkSize -
        1
      );


    for (
      let globalIndex = overlapStart;
      globalIndex <= overlapEnd;
      globalIndex++
    ) {

      const sourceIndex =
        globalIndex -
        startIndex;


      const chunkLocalIndex =
        globalIndex -
        chunkGlobalStart;


      chunkValues[chunkLocalIndex] =
        valuesToSave[sourceIndex] ||
        '';
    }


    /*
     * Trim trailing blanks để property nhỏ hơn.
     */
    let lastNonBlank =
      chunkValues.length -
      1;


    while (
      lastNonBlank >= 0 &&
      !chunkValues[lastNonBlank]
    ) {

      lastNonBlank--;
    }


    const compact =
      lastNonBlank >= 0
        ? chunkValues.slice(
            0,
            lastNonBlank + 1
          )
        : [];


    if (
      compact.length
    ) {

      properties.setProperty(
        key,
        JSON.stringify(
          compact
        )
      );

    } else {

      properties.deleteProperty(
        key
      );
    }
  }


  /*
   * CACHE_COUNT vẫn được duy trì
   * để tương thích hàm save/load cũ.
   */
  const countKey =
    SMART_BRAND_CONFIG.PROPERTY_PREFIX +
    'CACHE_COUNT';


  const currentCount =
    Number(
      properties.getProperty(
        countKey
      )
    ) ||
    0;


  const neededCount =
    lastChunk +
    1;


  if (
    neededCount >
    currentCount
  ) {

    properties.setProperty(
      countKey,
      String(
        neededCount
      )
    );
  }
}


/***************************************************************
 * WRITE CHỈ NHỮNG BLOCK BỊ THAY ĐỔI
 *
 * GIỮ NGUYÊN TÊN + LOGIC HÀM CŨ.
 *
 * outputBrands:
 * mảng global tính từ START_ROW.
 *
 * changedIndexes:
 * index global tính từ START_ROW.
 ***************************************************************/
function writeChangedBrandBlocks_(
  sheet,
  outputBrands,
  changedIndexes
) {

  if (
    !changedIndexes.length
  ) {

    return;
  }


  const blocks = [];


  let blockStart =
    changedIndexes[0];


  let previous =
    changedIndexes[0];


  for (
    let i = 1;
    i < changedIndexes.length;
    i++
  ) {

    const current =
      changedIndexes[i];


    if (
      current ===
      previous + 1
    ) {

      previous =
        current;

      continue;
    }


    blocks.push(
      [
        blockStart,
        previous
      ]
    );


    blockStart =
      current;


    previous =
      current;
  }


  blocks.push(
    [
      blockStart,
      previous
    ]
  );


  for (
    let b = 0;
    b < blocks.length;
    b++
  ) {

    const startIndex =
      blocks[b][0];


    const endIndex =
      blocks[b][1];


    const length =
      endIndex -
      startIndex +
      1;


    const values = [];


    for (
      let i = startIndex;
      i <= endIndex;
      i++
    ) {

      values.push(
        [
          Array.isArray(
            outputBrands[i]
          )
            ? outputBrands[i][0]
            : outputBrands[i]
        ]
      );
    }


    const sheetRow =
      SMART_BRAND_CONFIG.START_ROW +
      startIndex;


    sheet
      .getRange(
        sheetRow,
        SMART_BRAND_CONFIG.BRAND_COL,
        length,
        1
      )
      .setValues(
        values
      );
  }
}


/***************************************************************
 * WRITE CHANGES CHO BATCH
 ***************************************************************/
function writeBrandRangeChanges_(
  sheet,
  batchStartRow,
  outputBrands,
  changedLocalIndexes
) {

  if (
    !changedLocalIndexes.length
  ) {

    return;
  }


  const blocks = [];


  let blockStart =
    changedLocalIndexes[0];


  let previous =
    changedLocalIndexes[0];


  for (
    let i = 1;
    i < changedLocalIndexes.length;
    i++
  ) {

    const current =
      changedLocalIndexes[i];


    if (
      current ===
      previous + 1
    ) {

      previous =
        current;

      continue;
    }


    blocks.push(
      [
        blockStart,
        previous
      ]
    );


    blockStart =
      current;


    previous =
      current;
  }


  blocks.push(
    [
      blockStart,
      previous
    ]
  );


  for (
    let b = 0;
    b < blocks.length;
    b++
  ) {

    const localStart =
      blocks[b][0];


    const localEnd =
      blocks[b][1];


    const length =
      localEnd -
      localStart +
      1;


    const values = [];


    for (
      let i = localStart;
      i <= localEnd;
      i++
    ) {

      values.push(
        [
          Array.isArray(
            outputBrands[i]
          )
            ? outputBrands[i][0]
            : outputBrands[i]
        ]
      );
    }


    sheet
      .getRange(
        batchStartRow +
          localStart,
        SMART_BRAND_CONFIG.BRAND_COL,
        length,
        1
      )
      .setValues(
        values
      );
  }
}


/***************************************************************
 * CLEAN STRING
 *
 * GIỮ NGUYÊN HÀM CŨ.
 ***************************************************************/
function cleanString_(
  value
) {

  return String(
    value ||
    ''
  )
    .replace(
      /\u00A0/g,
      ' '
    )
    .trim();
}


/***************************************************************
 * ESCAPE REGEX
 *
 * GIỮ NGUYÊN HÀM CŨ.
 ***************************************************************/
function escapeSmartRegex_(
  text
) {

  return String(
    text
  )
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );
}


/***************************************************************
 * STATUS / RESET FULL BRAND SCAN
 ***************************************************************/
function showBrandProcessingStatus() {
  const props = PropertiesService.getDocumentProperties();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inputSheet = ss.getSheetByName(SMART_BRAND_CONFIG.INPUT_SHEET);
  const sheetLastRow = inputSheet ? getLastBrandSourceRow_(inputSheet) : 0;

  const selected = loadSelectedBrandJob_();
  const fullState = loadBrandJsonState_(SMART_BRAND_KEYS.FULL_SCAN_STATE);
  const pendingState = loadBrandJsonState_(SMART_BRAND_KEYS.PENDING_STATE);
  const rollingState = loadBrandJsonState_(SMART_BRAND_KEYS.ROLLING_STATE);
  const lastActivity = loadBrandJsonState_(SMART_BRAND_KEYS.LAST_ACTIVITY);
  const lastError = loadBrandJsonState_(SMART_BRAND_KEYS.LAST_ERROR);

  const rebuildActive = props.getProperty(
    brandPropertyKey_(SMART_BRAND_KEYS.REBUILD_ACTIVE)
  ) === '1';
  const rebuildCursor = Number(props.getProperty(
    brandPropertyKey_(SMART_BRAND_KEYS.REBUILD_CURSOR)
  )) || SMART_BRAND_CONFIG.START_ROW;
  const rollingCursor = Number(props.getProperty(
    brandPropertyKey_(SMART_BRAND_KEYS.SCAN_CURSOR)
  )) || SMART_BRAND_CONFIG.START_ROW;

  const lines = [];
  lines.push('BRAND PROCESSING STATUS');
  lines.push('');

  if (lastActivity) {
    lines.push('LATEST ACTIVITY');
    lines.push('Mode: ' + brandStateValue_(lastActivity.mode, 'UNKNOWN'));
    lines.push('Status: ' + brandStateValue_(lastActivity.status, 'UNKNOWN'));
    lines.push('Range: ' + brandRangeText_(lastActivity.startRow, lastActivity.endRow));
    lines.push('Current row: ' + brandStateValue_(lastActivity.currentRow, '-'));
    lines.push('Last success row: ' + brandStateValue_(lastActivity.lastSuccessRow, '-'));
    lines.push('Next row: ' + brandStateValue_(lastActivity.nextRow, '-'));
    lines.push('Updated at: ' + brandFormatStateTime_(lastActivity.updatedAt, ss));
    lines.push('');
  } else {
    lines.push('LATEST ACTIVITY: chưa có state.');
    lines.push('');
  }

  lines.push('SELECTED');
  if (selected) {
    lines.push('Status: ' + brandStateValue_(selected.status, 'UNKNOWN'));
    lines.push('Phase: ' + brandStateValue_(selected.phase, '-'));
    lines.push('Range: ' + brandRangeText_(selected.startRow, selected.endRow));
    lines.push('Current row: ' + brandStateValue_(selected.cursor, '-'));
    lines.push('Last success row: ' + brandStateValue_(selected.lastSuccessRow, '-'));
    lines.push('Next row: ' + brandStateValue_(selected.cursor, '-'));
    lines.push('Checked: ' + (Number(selected.checked) || 0) +
      ' | Matched: ' + (Number(selected.matched) || 0) +
      ' | Filled: ' + (Number(selected.filled) || 0) +
      ' | Updated: ' + (Number(selected.updated) || 0));
    lines.push('Unresolved: ' + (Number(selected.unresolved) || 0) +
      ' | No source skipped: ' + (Number(selected.noSourceSkipped) || 0));
    lines.push('Updated at: ' + brandFormatStateTime_(selected.updatedAt, ss));
    if (selected.errorMessage) {
      lines.push('ERROR phase: ' + brandStateValue_(selected.errorPhase, '-'));
      lines.push('ERROR row: ' + brandStateValue_(selected.errorRow, '-'));
      lines.push('ERROR: ' + String(selected.errorMessage).slice(0, 500));
    }
  } else {
    lines.push('Status: NONE');
  }
  lines.push('');

  lines.push('FULL SCAN');
  if (fullState || rebuildActive) {
    const fs = fullState || {};
    lines.push('Status: ' + (rebuildActive ? 'RUNNING' : brandStateValue_(fs.status, 'IDLE/DONE')));
    lines.push('Range: ' + brandRangeText_(fs.startRow || SMART_BRAND_CONFIG.START_ROW, fs.endRow || sheetLastRow));
    lines.push('Current row: ' + (rebuildActive ? rebuildCursor : brandStateValue_(fs.currentRow || fs.cursor, '-')));
    lines.push('Last success row: ' + brandStateValue_(fs.lastSuccessRow, '-'));
    lines.push('Next row: ' + (rebuildActive ? rebuildCursor : brandStateValue_(fs.nextRow, '-')));
    lines.push('Checked: ' + (Number(fs.checked) || 0) +
      ' | Skipped: ' + (Number(fs.skipped) || 0) +
      ' | Detected: ' + (Number(fs.detected) || 0) +
      ' | Changed: ' + (Number(fs.changed) || 0));
    lines.push('Unresolved: ' + (Number(fs.unresolved) || 0));
    lines.push('Updated at: ' + brandFormatStateTime_(fs.updatedAt, ss));
  } else {
    lines.push('Status: IDLE');
    lines.push('Next row: ' + rebuildCursor);
  }
  lines.push('');

  lines.push('PENDING');
  if (pendingState) {
    lines.push('Status: ' + brandStateValue_(pendingState.status, 'UNKNOWN'));
    lines.push('Range: ' + brandRangeText_(pendingState.startRow, pendingState.endRow));
    lines.push('Current row: ' + brandStateValue_(pendingState.currentRow, '-'));
    lines.push('Last success row: ' + brandStateValue_(pendingState.lastSuccessRow, '-'));
    lines.push('Next row: ' + brandStateValue_(pendingState.nextRow, '-'));
    lines.push('Checked: ' + (Number(pendingState.checked) || 0) +
      ' | Skipped: ' + (Number(pendingState.skipped) || 0) +
      ' | Detected: ' + (Number(pendingState.detected) || 0) +
      ' | Changed: ' + (Number(pendingState.changed) || 0));
    lines.push('Updated at: ' + brandFormatStateTime_(pendingState.updatedAt, ss));
  } else {
    lines.push('Status: NONE');
  }
  lines.push('');

  lines.push('ROLLING SCAN');
  if (rollingState) {
    lines.push('Status: ' + brandStateValue_(rollingState.status, 'UNKNOWN'));
    lines.push('Last batch: ' + brandRangeText_(rollingState.startRow, rollingState.endRow));
    lines.push('Last success row: ' + brandStateValue_(rollingState.lastSuccessRow, '-'));
    lines.push('Next row: ' + brandStateValue_(rollingState.nextRow || rollingCursor, rollingCursor));
    lines.push('Sheet last row: ' + sheetLastRow);
    lines.push('Checked: ' + (Number(rollingState.checked) || 0) +
      ' | Skipped: ' + (Number(rollingState.skipped) || 0) +
      ' | Detected: ' + (Number(rollingState.detected) || 0) +
      ' | Changed: ' + (Number(rollingState.changed) || 0));
    lines.push('Updated at: ' + brandFormatStateTime_(rollingState.updatedAt, ss));
  } else {
    lines.push('Status: chưa chạy');
    lines.push('Next row: ' + rollingCursor);
    lines.push('Sheet last row: ' + sheetLastRow);
  }
  lines.push('');

  lines.push('LAST ERROR');
  if (lastError && lastError.message) {
    lines.push('Phase: ' + brandStateValue_(lastError.phase, '-'));
    lines.push('Row: ' + brandStateValue_(lastError.row, '-'));
    lines.push('Time: ' + brandFormatStateTime_(lastError.updatedAt, ss));
    lines.push('Message: ' + String(lastError.message).slice(0, 700));
  } else {
    lines.push('NONE');
  }

  const statusText = lines.join('\n');
  console.log('[BRAND STATUS]\n' + statusText);

  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;padding:16px;white-space:pre-wrap;line-height:1.45;font-size:13px">' +
    brandEscapeHtml_(statusText) +
    '</div>'
  ).setWidth(620).setHeight(720);

  SpreadsheetApp.getUi().showModalDialog(html, 'Brand Processing Status');

  ss.toast(
    lastActivity
      ? 'Last success row ' + brandStateValue_(lastActivity.lastSuccessRow, '-') +
        ' | Next ' + brandStateValue_(lastActivity.nextRow, '-') +
        ' | ' + brandStateValue_(lastActivity.mode, 'UNKNOWN') + ' / ' + brandStateValue_(lastActivity.status, 'UNKNOWN')
      : 'Chưa có Brand activity state.',
    'BRAND STATUS',
    8
  );
}


function resetAndScanBrandFromStart() {
  const ss =
    SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    throw new Error(
      'Không có active Spreadsheet để Reset Brand.'
    );
  }

  rememberBrandSpreadsheet_(ss);
  ensureBrandRuleInvalidationTrigger_(ss);

  const inputSheet =
    ss.getSheetByName(
      SMART_BRAND_CONFIG.INPUT_SHEET
    );

  const ruleSheet =
    ss.getSheetByName(
      SMART_BRAND_CONFIG.RULE_SHEET
    );

  if (!inputSheet) {
    throw new Error(
      'Không tìm thấy sheet "' +
      SMART_BRAND_CONFIG.INPUT_SHEET +
      '".'
    );
  }

  if (!ruleSheet) {
    throw new Error(
      'Không tìm thấy sheet "' +
      SMART_BRAND_CONFIG.RULE_SHEET +
      '".'
    );
  }

  const liveLease =
    getBrandExecutionLeaseState_();

  if (liveLease) {
    ss.toast(
      'Brand worker đang chạy (' +
      (liveLease.mode || 'UNKNOWN') +
      '). Chờ worker hiện tại xong rồi Reset lại.',
      'BRAND RESET',
      8
    );
    return;
  }

  const leaseToken =
    acquireBrandExecutionLease_('RESET');

  if (!leaseToken) {
    ss.toast(
      'Không lấy được Brand lease. Thử lại sau.',
      'BRAND RESET',
      6
    );
    return;
  }

  try {
    deleteBrandContinuationTriggers_();
    deleteBrandWatchdogTriggers_();
    deleteSelectedBrandContinuationTriggers_();
    deleteSelectedBrandWatchdogTriggers_();

    const selected =
      loadSelectedBrandJob_();

    if (
      selected &&
      selected.status !== 'DONE' &&
      selected.status !== 'ERROR'
    ) {
      selected.status =
        'CANCELLED_BY_FULL_RESET';
      selected.phase =
        'CANCELLED_BY_FULL_RESET';
      selected.updatedAt = Date.now();
      saveSelectedBrandJob_(selected);
    }

    clearSmartBrandRuleCache_(ruleSheet);
    clearSmartBrandCache_();
    resetBrandBackgroundRetry_();

    // clearSmartBrandCache_ giữ lại lease + spreadsheet binding.
    const props =
      PropertiesService.getDocumentProperties();

    props.setProperty(
      brandPropertyKey_(
        SMART_BRAND_KEYS.REBUILD_ACTIVE
      ),
      '1'
    );

    props.setProperty(
      brandPropertyKey_(
        SMART_BRAND_KEYS.REBUILD_CURSOR
      ),
      String(
        SMART_BRAND_CONFIG.START_ROW
      )
    );

    props.deleteProperty(
      brandPropertyKey_(
        SMART_BRAND_KEYS.RULE_HASH
      )
    );

    props.deleteProperty(
      brandPropertyKey_(
        SMART_BRAND_KEYS.ACTIVE_RULE_HASH
      )
    );

    props.deleteProperty(
      brandPropertyKey_(
        SMART_BRAND_KEYS.LAST_ERROR
      )
    );

    const resetState = {
      status: 'QUEUED',
      startRow:
        SMART_BRAND_CONFIG.START_ROW,
      endRow: getLastBrandSourceRow_(inputSheet),
      cursor:
        SMART_BRAND_CONFIG.START_ROW,
      currentRow:
        SMART_BRAND_CONFIG.START_ROW,
      lastSuccessRow:
        SMART_BRAND_CONFIG.START_ROW - 1,
      nextRow:
        SMART_BRAND_CONFIG.START_ROW,
      checked: 0,
      skipped: 0,
      detected: 0,
      unresolved: 0,
      changed: 0,
      startedAt: Date.now(),
      updatedAt: Date.now()
    };

    saveBrandJsonState_(
      SMART_BRAND_KEYS.FULL_SCAN_STATE,
      resetState
    );

    saveBrandLastActivity_(
      Object.assign(
        { mode: 'FULL_SCAN' },
        resetState
      )
    );

  } finally {
    releaseBrandExecutionLease_(leaseToken);
  }

  scheduleBrandContinuation_();
  scheduleBrandWatchdog_();

  ss.toast(
    'Brand Full Scan đã QUEUED từ row 2. Worker sẽ chạy nền và lưu cursor sau từng batch.',
    'BRAND RESET',
    8
  );
}


function saveBrandLastError_(error, phase) {
  const props = PropertiesService.getDocumentProperties();
  const rebuildActive = props.getProperty(
    brandPropertyKey_(SMART_BRAND_KEYS.REBUILD_ACTIVE)
  ) === '1';

  let mode = 'ROLLING';
  let row = Number(props.getProperty(
    brandPropertyKey_(SMART_BRAND_KEYS.SCAN_CURSOR)
  )) || SMART_BRAND_CONFIG.START_ROW;

  if (rebuildActive) {
    mode = 'FULL_SCAN';
    row = Number(props.getProperty(
      brandPropertyKey_(SMART_BRAND_KEYS.REBUILD_CURSOR)
    )) || SMART_BRAND_CONFIG.START_ROW;
  } else {
    const pending = loadBrandPendingRanges_(props);
    if (pending && pending.length) {
      mode = 'PENDING';
      row = Number(pending[0][0]) || SMART_BRAND_CONFIG.START_ROW;
    }
  }

  const errorState = {
    phase: phase || 'BRAND',
    mode: mode,
    row: row,
    message: brandFormatError_(error),
    updatedAt: Date.now()
  };

  saveBrandJsonState_(SMART_BRAND_KEYS.LAST_ERROR, errorState);

  const last = loadBrandJsonState_(SMART_BRAND_KEYS.LAST_ACTIVITY) || {};
  saveBrandLastActivity_({
    mode: mode,
    status: 'ERROR',
    startRow: Number(last.startRow) || 0,
    endRow: Number(last.endRow) || 0,
    currentRow: row,
    lastSuccessRow: Number(last.lastSuccessRow) || Math.max(SMART_BRAND_CONFIG.START_ROW - 1, row - 1),
    nextRow: row,
    errorPhase: errorState.phase,
    errorRow: row,
    errorMessage: errorState.message,
    updatedAt: errorState.updatedAt
  });
}


/***************************************************************
 * BRAND STATE HELPERS — V4
 ***************************************************************/
function loadBrandJsonState_(keyName) {
  const raw = PropertiesService.getDocumentProperties().getProperty(
    brandPropertyKey_(keyName)
  );
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    return null;
  }
}

function saveBrandJsonState_(keyName, value) {
  const props = PropertiesService.getDocumentProperties();
  const key = brandPropertyKey_(keyName);
  if (!value) {
    props.deleteProperty(key);
    return;
  }
  props.setProperty(key, JSON.stringify(value));
}

function saveBrandLastActivity_(state) {
  if (!state || typeof state !== 'object') return;
  const payload = Object.assign({}, state);
  payload.updatedAt = Number(payload.updatedAt) || Date.now();
  saveBrandJsonState_(SMART_BRAND_KEYS.LAST_ACTIVITY, payload);
}

function brandRangeText_(startRow, endRow) {
  const start = Number(startRow) || 0;
  const end = Number(endRow) || 0;
  if (!start && !end) return '-';
  if (start && !end) return String(start);
  if (!start && end) return String(end);
  return start + ':' + end;
}

function brandStateValue_(value, fallback) {
  if (value === 0) return '0';
  if (value === null || value === undefined || value === '') {
    return fallback === undefined ? '-' : String(fallback);
  }
  return String(value);
}

function brandFormatStateTime_(value, ss) {
  const ms = Number(value) || 0;
  if (!ms) return '-';
  let tz = 'Asia/Ho_Chi_Minh';
  try {
    if (ss && ss.getSpreadsheetTimeZone()) {
      tz = ss.getSpreadsheetTimeZone();
    }
  } catch (error) {}
  try {
    return Utilities.formatDate(new Date(ms), tz, 'dd/MM/yyyy HH:mm:ss');
  } catch (error) {
    return new Date(ms).toISOString();
  }
}

function brandEscapeHtml_(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/***************************************************************
 * FORCE REBUILD
 *
 * GIỮ NGUYÊN TÊN HÀM CŨ.
 *
 * Khác bản cũ:
 * - Không clear xong rồi cố quét cả sheet trong 1 execution.
 * - Set rebuild cursor.
 * - smartUpdateBrands xử lý từng batch + resume.
 ***************************************************************/
function forceRebuildAllBrands() {
  resetAndScanBrandFromStart();
}


/***************************************************************
 * CLEAR CACHE
 *
 * GIỮ NGUYÊN TÊN HÀM CŨ.
 ***************************************************************/
function clearSmartBrandCache_() {
  const properties =
    PropertiesService.getDocumentProperties();

  const all =
    properties.getProperties();

  const keep = Object.create(null);

  keep[
    brandPropertyKey_(
      SMART_BRAND_KEYS.EXECUTION_LEASE
    )
  ] = true;

  keep[
    brandPropertyKey_(
      SMART_BRAND_KEYS.SPREADSHEET_ID
    )
  ] = true;

  Object.keys(all).forEach(
    function(key) {
      if (
        key.indexOf(
          SMART_BRAND_CONFIG.PROPERTY_PREFIX
        ) === 0 &&
        !keep[key]
      ) {
        properties.deleteProperty(key);
      }
    }
  );

  console.log(
    '[BRAND] Cache/state đã clear; giữ lease + spreadsheet binding.'
  );
}


/***************************************************************
 * TEST DÒNG ĐANG CHỌN
 *
 * GIỮ NGUYÊN TÊN HÀM CŨ.
 *
 * Bản cũ dùng getUi().alert().
 * Khi chạy từ Apps Script Editor, alert có thể đứng chờ
 * và execution nhìn giống timeout 360s.
 *
 * Bản mới:
 * - log chi tiết
 * - toast trên Sheet
 * - không block execution
 ***************************************************************/
function testCurrentBrandRow() {

  const ss =
    SpreadsheetApp
      .getActiveSpreadsheet();


  const sheet =
    ss.getActiveSheet();


  if (
    !sheet ||
    sheet.getName() !==
      SMART_BRAND_CONFIG.INPUT_SHEET
  ) {

    console.log(
      '[BRAND TEST] Hãy chọn một ô trong INPUT.'
    );


    ss.toast(
      'Hãy chọn một ô trong INPUT.',
      'BRAND TEST',
      5
    );


    return;
  }


  const row =
    sheet
      .getActiveCell()
      .getRow();


  if (
    row <
    SMART_BRAND_CONFIG.START_ROW
  ) {

    return;
  }


  const modelK =
    sheet
      .getRange(
        row,
        SMART_BRAND_CONFIG.MODEL_COL
      )
      .getDisplayValue();


  const fullSEO =
    sheet
      .getRange(
        row,
        SMART_BRAND_CONFIG.FULL_SEO_COL
      )
      .getDisplayValue();


  const ruleSheet =
    ss.getSheetByName(
      SMART_BRAND_CONFIG.RULE_SHEET
    );


  if (
    !ruleSheet
  ) {

    throw new Error(
      'Không tìm thấy sheet "' +
      SMART_BRAND_CONFIG.RULE_SHEET +
      '".'
    );
  }


  const ruleData =
    loadSmartBrandRules_(
      ruleSheet
    );


  const text =
    normalizeBrandText_(
      modelK +
      ' ' +
      fullSEO
    );


  const matches = [];


  for (
    let i = 0;
    i < ruleData.rules.length;
    i++
  ) {

    const rule =
      ruleData.rules[i];


    if (
      smartBrandRuleMatchesFast_(
        text,
        rule
      )
    ) {

      matches.push(
        {

          text:
            rule.original,

          brand:
            rule.brand,

          priority:
            rule.priority,

          type:
            rule.type,

          source:
            rule.source,

          ruleRow:
            rule.row
        }
      );
    }


    if (
      matches.length >=
      30
    ) {

      break;
    }
  }


  if (
    !matches.length
  ) {

    console.log(
      '[BRAND TEST]' +
      ' ROW=' + row +
      ' | Model K=' + modelK +
      ' | Full SEO=' + fullSEO +
      ' | KHÔNG MATCH'
    );


    ss.toast(
      'Row ' +
      row +
      ': không match Brand',
      'BRAND TEST',
      8
    );


    return;
  }


  const winner =
    matches[0];


  console.log(
    '[BRAND TEST]' +
    ' ROW=' + row +
    ' | Model K=' + modelK +
    ' | Full SEO=' + fullSEO +
    ' | BRAND=' + winner.brand
  );


  console.log(
    '[BRAND TEST MATCHES] ' +
    JSON.stringify(
      matches
    )
  );


  ss.toast(
    'Row ' +
    row +
    ' → ' +
    winner.brand +
    ' | ' +
    winner.text +
    ' | P' +
    winner.priority,
    'BRAND TEST',
    10
  );
}


/***************************************************************
 * MARK PENDING RANGE
 *
 * HÀM MỚI.
 *
 * Sau này code import / SEO có thể gọi:
 *
 * markBrandRowsPending(379, 385);
 * smartUpdateBrands();
 *
 * Brand sẽ ưu tiên đúng các dòng đó.
 ***************************************************************/
function markBrandRowsPending(
  startRow,
  endRow
) {

  startRow =
    Math.max(
      SMART_BRAND_CONFIG.START_ROW,
      Number(
        startRow
      ) ||
      SMART_BRAND_CONFIG.START_ROW
    );


  endRow =
    Math.max(
      startRow,
      Number(
        endRow
      ) ||
      startRow
    );


  const properties =
    PropertiesService
      .getDocumentProperties();


  const ranges =
    loadBrandPendingRanges_(
      properties
    );


  ranges.push(
    [
      startRow,
      endRow
    ]
  );


  saveBrandPendingRanges_(
    properties,
    mergeBrandRanges_(
      ranges
    )
  );
}


/***************************************************************
 * MARK 1 ROW PENDING
 ***************************************************************/
function markBrandRowPending(
  row
) {

  markBrandRowsPending(
    row,
    row
  );
}


/***************************************************************
 * RULE CHANGE
 ***************************************************************/
function prepareBrandRuleRebuildIfNeeded_(
  properties,
  currentRuleHash
) {

  const savedHash =
    properties.getProperty(
      brandPropertyKey_(
        SMART_BRAND_KEYS.RULE_HASH
      )
    ) ||
    '';


  if (
    savedHash ===
    currentRuleHash
  ) {

    return;
  }


  const activeHash =
    properties.getProperty(
      brandPropertyKey_(
        SMART_BRAND_KEYS.ACTIVE_RULE_HASH
      )
    ) ||
    '';


  /*
   * Rule đã đổi nhưng rebuild của đúng hash này đã active,
   * không reset cursor về row 2 nữa.
   */
  if (
    activeHash ===
    currentRuleHash
  ) {

    return;
  }


  properties.setProperty(
    brandPropertyKey_(
      SMART_BRAND_KEYS.ACTIVE_RULE_HASH
    ),
    currentRuleHash
  );


  properties.setProperty(
    brandPropertyKey_(
      SMART_BRAND_KEYS.REBUILD_ACTIVE
    ),
    '1'
  );


  properties.setProperty(
    brandPropertyKey_(
      SMART_BRAND_KEYS.REBUILD_CURSOR
    ),
    String(
      SMART_BRAND_CONFIG.START_ROW
    )
  );

  const ruleRebuildState = {
    status: 'RUNNING',
    startRow: SMART_BRAND_CONFIG.START_ROW,
    endRow: 0,
    cursor: SMART_BRAND_CONFIG.START_ROW,
    currentRow: SMART_BRAND_CONFIG.START_ROW,
    lastSuccessRow: SMART_BRAND_CONFIG.START_ROW - 1,
    nextRow: SMART_BRAND_CONFIG.START_ROW,
    checked: 0,
    skipped: 0,
    detected: 0,
    unresolved: 0,
    changed: 0,
    updatedAt: Date.now()
  };
  saveBrandJsonState_(SMART_BRAND_KEYS.FULL_SCAN_STATE, ruleRebuildState);
  saveBrandLastActivity_(Object.assign({ mode: 'FULL_SCAN' }, ruleRebuildState));


  console.log(
    '[BRAND] SEO NAME RULE thay đổi -> rebuild theo batch từ row ' +
    SMART_BRAND_CONFIG.START_ROW
  );
}


/***************************************************************
 * IS REBUILD ACTIVE
 ***************************************************************/
function isBrandRebuildActive_(
  properties
) {

  return (
    properties.getProperty(
      brandPropertyKey_(
        SMART_BRAND_KEYS.REBUILD_ACTIVE
      )
    ) ===
    '1'
  );
}


/***************************************************************
 * AUTO QUEUE DÒNG MỚI
 ***************************************************************/
function autoQueueNewBrandRows_(
  properties,
  currentLastRow
) {

  const oldLastRow =
    Number(
      properties.getProperty(
        brandPropertyKey_(
          SMART_BRAND_KEYS.LAST_KNOWN_LAST_ROW
        )
      )
    ) ||
    0;


  /*
   * Lần đầu chưa có state:
   * rule rebuild/full scan sẽ xử lý.
   */
  if (
    !oldLastRow
  ) {

    properties.setProperty(
      brandPropertyKey_(
        SMART_BRAND_KEYS.LAST_KNOWN_LAST_ROW
      ),
      String(
        currentLastRow
      )
    );


    return;
  }


  if (
    currentLastRow >
    oldLastRow
  ) {

    markBrandRowsPending(
      oldLastRow + 1,
      currentLastRow
    );


    properties.setProperty(
      brandPropertyKey_(
        SMART_BRAND_KEYS.LAST_KNOWN_LAST_ROW
      ),
      String(
        currentLastRow
      )
    );


    console.log(
      '[BRAND] Auto queue new rows ' +
      (
        oldLastRow + 1
      ) +
      ':' +
      currentLastRow
    );
  }
}


/***************************************************************
 * LOAD PENDING RANGES
 ***************************************************************/
function loadBrandPendingRanges_(
  properties
) {

  const raw =
    properties.getProperty(
      brandPropertyKey_(
        SMART_BRAND_KEYS.PENDING_RANGES
      )
    );


  if (
    !raw
  ) {

    return [];
  }


  try {

    const ranges =
      JSON.parse(
        raw
      );


    return Array.isArray(
      ranges
    )
      ? ranges
      : [];

  } catch (error) {

    console.log(
      '[BRAND] Pending range parse error: ' +
      error
    );


    return [];
  }
}


/***************************************************************
 * SAVE PENDING RANGES
 ***************************************************************/
function saveBrandPendingRanges_(
  properties,
  ranges
) {

  const key =
    brandPropertyKey_(
      SMART_BRAND_KEYS.PENDING_RANGES
    );


  if (
    !ranges ||
    !ranges.length
  ) {

    properties.deleteProperty(
      key
    );


    return;
  }


  properties.setProperty(
    key,
    JSON.stringify(
      ranges
    )
  );
}


/***************************************************************
 * MERGE PENDING RANGES
 ***************************************************************/
function mergeBrandRanges_(
  ranges
) {

  if (
    !ranges ||
    !ranges.length
  ) {

    return [];
  }


  const clean =
    ranges
      .map(
        function(range) {

          let start =
            Math.max(
              SMART_BRAND_CONFIG.START_ROW,
              Number(
                range[0]
              ) ||
              SMART_BRAND_CONFIG.START_ROW
            );


          let end =
            Math.max(
              SMART_BRAND_CONFIG.START_ROW,
              Number(
                range[1]
              ) ||
              start
            );


          if (
            start >
            end
          ) {

            const temp =
              start;


            start =
              end;


            end =
              temp;
          }


          return [
            start,
            end
          ];
        }
      )
      .sort(
        function(a, b) {

          return (
            a[0] -
            b[0]
          );
        }
      );


  const output =
    [
      clean[0]
    ];


  for (
    let i = 1;
    i < clean.length;
    i++
  ) {

    const current =
      clean[i];


    const previous =
      output[
        output.length -
        1
      ];


    if (
      current[0] <=
      previous[1] + 1
    ) {

      previous[1] =
        Math.max(
          previous[1],
          current[1]
        );

    } else {

      output.push(
        current
      );
    }
  }


  return output;
}


/***************************************************************
 * SCHEDULE CONTINUATION
 *
 * Tạo 1 trigger resume duy nhất.
 ***************************************************************/
function scheduleBrandContinuation_() {

  const handlerName =
    'continueSmartBrandUpdate_';


  const existing =
    ScriptApp
      .getProjectTriggers()
      .some(
        function(trigger) {

          return (
            trigger.getHandlerFunction() ===
            handlerName
          );
        }
      );


  if (
    existing
  ) {

    return;
  }


  ScriptApp
    .newTrigger(
      handlerName
    )
    .timeBased()
    .after(
      SMART_BRAND_CONFIG.CONTINUE_AFTER_MS
    )
    .create();


  console.log(
    '[BRAND] Đã lên lịch resume.'
  );
}


/***************************************************************
 * CONTINUATION HANDLER
 *
 * Trigger chạy 1 lần rồi tự xóa.
 ***************************************************************/
function continueSmartBrandUpdate_() {

  deleteBrandContinuationTriggers_();


  smartUpdateBrands();
}


/***************************************************************
 * DELETE BRAND CONTINUATION TRIGGERS
 ***************************************************************/
function deleteBrandContinuationTriggers_() {

  const handlerName =
    'continueSmartBrandUpdate_';


  ScriptApp
    .getProjectTriggers()
    .forEach(
      function(trigger) {

        if (
          trigger.getHandlerFunction() ===
          handlerName
        ) {

          ScriptApp.deleteTrigger(
            trigger
          );
        }
      }
    );
}

function scheduleBrandWatchdog_() {
  const handler =
    SMART_BRAND_CONFIG.BACKGROUND_WATCHDOG_HANDLER;

  const exists =
    ScriptApp
      .getProjectTriggers()
      .some(function(trigger) {
        return (
          trigger.getHandlerFunction() ===
          handler
        );
      });

  if (exists) {
    return;
  }

  ScriptApp
    .newTrigger(handler)
    .timeBased()
    .after(
      SMART_BRAND_CONFIG.BACKGROUND_WATCHDOG_AFTER_MS ||
      45000
    )
    .create();
}


function deleteBrandWatchdogTriggers_() {
  const handler =
    SMART_BRAND_CONFIG.BACKGROUND_WATCHDOG_HANDLER;

  ScriptApp
    .getProjectTriggers()
    .forEach(function(trigger) {
      if (
        trigger.getHandlerFunction() ===
        handler
      ) {
        ScriptApp.deleteTrigger(trigger);
      }
    });
}


function watchdogSmartBrandUpdate_() {
  deleteBrandWatchdogTriggers_();

  const lease =
    getBrandExecutionLeaseState_();

  if (lease) {
    console.log(
      '[BRAND WATCHDOG] Worker còn lease.' +
      ' Mode=' + lease.mode
    );
    scheduleBrandWatchdog_();
    return;
  }

  const props =
    PropertiesService.getDocumentProperties();

  const rebuildActive =
    props.getProperty(
      brandPropertyKey_(
        SMART_BRAND_KEYS.REBUILD_ACTIVE
      )
    ) === '1';

  const pending =
    loadBrandPendingRanges_(props);

  if (
    rebuildActive ||
    (pending && pending.length)
  ) {
    console.log(
      '[BRAND WATCHDOG] RESUME BACKGROUND'
    );
    scheduleBrandContinuation_();
  }
}



/***************************************************************
 * PUBLIC HELPER — DỌN TRIGGER BRAND
 *
 * Có thể chạy tay nếu cần.
 ***************************************************************/
function clearBrandContinuationTriggers() {

  deleteBrandContinuationTriggers_();


  console.log(
    '[BRAND] Đã xóa continuation trigger.'
  );
}


/***************************************************************
 * RESET STATE NHƯNG KHÔNG XÓA BRAND TRÊN INPUT
 *
 * Có thể dùng nếu cache/state lỗi.
 ***************************************************************/
function resetSmartBrandState() {
  deleteBrandContinuationTriggers_();
  deleteBrandWatchdogTriggers_();
  deleteSelectedBrandContinuationTriggers_();
  deleteSelectedBrandWatchdogTriggers_();

  const ss = getBrandSpreadsheet_();
  if (ss) {
    const ruleSheet =
      ss.getSheetByName(
        SMART_BRAND_CONFIG.RULE_SHEET
      );
    if (ruleSheet) {
      clearSmartBrandRuleCache_(ruleSheet);
    }
  }

  clearSmartBrandCache_();

  console.log(
    '[BRAND] Reset state hoàn tất.'
  );
}


/***************************************************************
 * PROPERTY KEY
 ***************************************************************/
function brandPropertyKey_(
  name
) {

  return (
    SMART_BRAND_CONFIG.PROPERTY_PREFIX +
    name
  );
}
