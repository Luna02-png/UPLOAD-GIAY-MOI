/*

 * SEO RULE / FULL SEO ENGINE

 * BẢN V9 — WATCHDOG NO-SPAM + TRIGGER SPREADSHEET BINDING + REGEX BOUNDARY FIX

 *

 * Nâng cấp chính:

 * - Giữ nguyên menu, ngày upload, RQ date, Checked date, onEdit,

 *   Smart Index, Pending Range, Update selected, cache rule.

 * - Full scan tự resume theo batch; không giữ execution tới timeout.

 * - Update selected lớn: xử lý batch đầu, phần còn lại đưa Pending.

 * - Reload rules không dùng blocking alert.

 * - Fix PREFIX để DM Molly -> Dr. Martens Molly,

 *   AJ4 -> Air Jordan 4, đồng thời tránh J Balvin -> Jordan Balvin.

 * - SEO và Brand tách riêng: file này KHÔNG gọi Brand.

 */



const CONFIG = {

  INPUT_SHEET: "INPUT",

  SEO_RULE_SHEET: "SEO NAME RULE",

  HEADER_ROW: 1,



  // =====================================================

  // HEADER NAMES

  // =====================================================

  HEADERS: {

    UPLOAD_DATE: "NGÀY UPLOAD",

    RAW_NAME: "Nickname không để tên hãng",

    SEO_NAME: "full SEO",

    RQ_STATUS: "Request TECH",

    RQ_DATE: "NGÀY RQ",

    CHECK_STATUS: "Final Check",

    CHECK_DATE: "Checked time"

  },



  // =====================================================

  // SEO RULE CACHE

  // =====================================================

  SEO_CACHE_KEY: "SEO_RULES_CACHE_V2",

  SEO_CACHE_SECONDS: 21600, // 6 giờ

  // Dùng cho time-driven trigger: không phụ thuộc ActiveSpreadsheet.
  SEO_SPREADSHEET_ID_KEY: "SEO_BOUND_SPREADSHEET_ID_V1",



  // =====================================================

  // SMART INDEX

  // =====================================================



  /*

   * Đánh dấu hệ thống đã quét full lần đầu hay chưa.

   *

   * Chưa có:

   * Fill blanks sẽ full scan 1 lần.

   *

   * Có rồi:

   * Fill blanks chỉ xử lý pending rows.

   */

  SMART_INDEX_READY_KEY:

    "SEO_SMART_INDEX_READY_V4",



  /*

   * Lưu dòng cuối cùng mà Smart Index đã kiểm tra.

   *

   * Nhờ vậy sau lần full scan đầu tiên,

   * Fill blanks chỉ cần kiểm tra:

   *

   * - pending rows

   * - các row mới nằm sau LAST_INDEXED_ROW

   */

  LAST_INDEXED_ROW_KEY:

    "SEO_LAST_INDEXED_ROW_V4",



  /*

   * Lưu những range cần xử lý.

   */

  PENDING_RANGES_KEY:

    "SEO_PENDING_RANGES_V4",



  /*

   * Checkpoint riêng cho lần quét full đầu tiên.

   * Dùng key V4 để bắt buộc quét sạch 1 lần sau khi nâng cấp code,

   * không kế thừa trạng thái Smart Index cũ có thể đã sai.

   */

  INIT_CURSOR_KEY:

    "SEO_INIT_CURSOR_V4",



  INIT_LAST_ROW_KEY:

    "SEO_INIT_LAST_ROW_V4",



  // =====================================================

  // TIMEOUT SAFE SEO ENGINE

  // =====================================================



  /*

   * Số dòng tối đa xử lý trong 1 batch của menu.

   * Giữ batch vừa phải để tránh 1 lần đọc/ghi quá lớn.

   */

  SEO_BATCH_SIZE: 40,



  /*

   * Chủ động dừng trước giới hạn execution của Apps Script.

   * Khi dừng, checkpoint/pending đã được lưu nên lần sau chạy tiếp.

   */

  SEO_SAFE_RUNTIME_MS: 25000, // 25 giây



  /*

   * onEdit là simple trigger, thời gian chạy ngắn.

   * Edit/paste nhỏ vẫn xử lý ngay như cũ.

   * Paste lớn chỉ ghi Pending để tránh timeout.

   */

  ON_EDIT_IMMEDIATE_MAX_ROWS: 10,



  // =====================================================

  // AUTO RESUME / BATCH CONTROL (MỚI)

  // =====================================================



  /*

   * Mỗi execution chỉ chạy tối đa số batch này.

   * Tránh giữ execution tới sát 6 phút.

   */

  SEO_MAX_BATCHES_PER_RUN: 4,



  /*

   * Tự chạy tiếp sau khi còn pending/full scan chưa xong.

   */

  SEO_AUTO_RESUME: true,



  /*

   * Delay trigger resume.

   */

  SEO_CONTINUE_AFTER_MS: 60000,



  /*

   * Handler riêng cho SEO, tách hoàn toàn Brand.

   */

  SEO_CONTINUE_HANDLER: "continueSeoWork_",




  // SAFETY RESUME cho Full SEO.
  // Arm trước xử lý; hard-timeout/cancel cứng => trigger vẫn còn.
  SEO_WATCHDOG_HANDLER: "watchdogSeoWork_",
  SEO_WATCHDOG_AFTER_MS: 90000,
  // =====================================================

  // DATE ENGINE — TÁCH KHỎI SEO (MỚI)

  // =====================================================

  /*

   * RQ / Checked / Upload Date phải chạy độc lập,

   * không chờ SEO lock, không scan SEO rules, không pending SEO.

   */

  DATE_BATCH_SIZE: 1000,



  /*

   * Header cache giúp các thao tác ngày không phải đọc lại

   * toàn bộ header nhiều lần trong cùng một phiên.

   */

  HEADER_CACHE_KEY: "INPUT_HEADER_MAP_V1",

  HEADER_CACHE_SECONDS: 21600,

  // UPDATE SELECTED DATE — timeout safe
  SELECTED_DATE_BATCH_SIZE: 100,
  SELECTED_DATE_JOB_KEY: "SELECTED_DATE_JOB_V1",
  SELECTED_DATE_CONTINUE_HANDLER: "continueSelectedDateUpdate_",
  SELECTED_DATE_CONTINUE_AFTER_MS: 60000,

  // RELOAD REQUEST TECH + FINAL CHECK — full sheet, timeout safe
  DATE_RELOAD_BATCH_SIZE: 1000,
  DATE_RELOAD_MAX_BATCHES_PER_RUN: 3,
  DATE_RELOAD_JOB_KEY: "DATE_RELOAD_JOB_V1",
  DATE_RELOAD_CONTINUE_HANDLER: "continueDateReload_",
  DATE_RELOAD_CONTINUE_AFTER_MS: 60000,

  // UPDATE SELECTED SEO + DATE — job riêng, không dùng Pending/Smart Index
  // Micro-batch + checkpoint sau mỗi batch để tránh state RUNNING giả / timeout.
  // Selected SEO V5:
  // Menu chỉ snapshot + queue rồi thoát ngay.
  // Worker xử lý 1 batch/execution để tránh Menu đứng 6 phút.
  SELECTED_SEO_BATCH_SIZE: 20,
  SELECTED_SEO_MAX_BATCHES_PER_RUN: 1,
  SELECTED_SEO_SAFE_RUNTIME_MS: 15000,
  SELECTED_SEO_JOB_KEY: "SELECTED_SEO_JOB_V9",
  SELECTED_SEO_CONTINUE_HANDLER: "continueSelectedSeoDate_",
  SELECTED_SEO_CONTINUE_AFTER_MS: 5000,
  SELECTED_SEO_STALE_MS: 60000,


  // SAFETY RESUME cho Selected SEO.
  // Worker arm watchdog trước open/read/convert/write.
  // Bình thường finally xóa; hard-timeout => watchdog sống sót.
  SELECTED_SEO_WATCHDOG_HANDLER: "watchdogSelectedSeoDate_",
  SELECTED_SEO_WATCHDOG_AFTER_MS: 45000,
  // Lease riêng cho Selected SEO.
  // Chỉ lease còn hạn mới được coi là execution THẬT đang chạy.
  SELECTED_SEO_LEASE_KEY: "SELECTED_SEO_LEASE_V9",
  SELECTED_SEO_LEASE_MS: 30000,
  SELECTED_SEO_LEASE_LOCK_WAIT_MS: 3000,

  // Trạng thái full scan SEO để biết đang đứng ở đâu / lỗi gì
  SEO_SCAN_STATE_KEY: "SEO_SCAN_STATE_V2"
};





// ======================================================

// MENU

// ======================================================



function onOpen() {
  rememberSeoSpreadsheet_(SpreadsheetApp.getActiveSpreadsheet());
  SpreadsheetApp.getUi()
    .createMenu("INPUT Tools")
    .addItem("Fill blanks: SEO + Date", "fillBlanksSeoDate")
    .addItem("Update selected: SEO + Date", "updateSelectedSeoDate")
    .addItem("SEO processing status", "showSeoProcessingStatus")
    .addItem("Reset + scan SEO from row 2", "resetAndScanSeoFromStart")
    .addSeparator()
    .addItem("Update selected Brand", "updateSelectedBrandRows")
    .addItem("Brand processing status", "showBrandProcessingStatus")
    .addItem("Reset + scan Brand from row 2", "resetAndScanBrandFromStart")
    .addSeparator()
    .addItem("Fill missing upload dates", "fillMissingUploadDates")
    .addItem("Fill missing RQ Team Tech dates", "dateStatusReloadRqOnly")
    .addItem("Fill missing checked dates", "dateStatusReloadCheckOnly")
    .addSeparator()
    .addItem("Update selected RQ Team Tech dates", "dateStatusUpdateSelectedRqOnly")
    .addItem("Update selected checked dates", "dateStatusUpdateSelectedCheckOnly")
    .addSeparator()
    .addItem("Reload Request TECH + Final Check", "reloadRequestTechCheckedTime")
    .addSeparator()
    .addItem("Reload SEO rules", "reloadSeoRules")
    .addToUi();
}


// ======================================================


// AUTO EDIT

// ======================================================



function onEdit(e) {

  if (!e || !e.range) return;



  const sh = e.range.getSheet();

  const sheetName = sh.getName();



  // =====================================================

  // SEO NAME RULE EDIT

  // =====================================================



  if (sheetName === CONFIG.SEO_RULE_SHEET) {

    clearSeoRulesCache_();



    /*

     * Rule đổi thì SEO đúng cũng có thể đổi.

     * Chỉ reset trạng thái Smart Index, KHÔNG đụng dữ liệu sheet.

     * Lần Fill blanks kế tiếp sẽ quét lại từ đầu theo rule mới.

     */

    invalidateSeoSmartIndex_();

    return;

  }



  if (sheetName !== CONFIG.INPUT_SHEET) {

    return;

  }



  /*

   * Header thay đổi => xóa header cache.

   * Không chạy các tác vụ data cho row header.

   */

  if (

    e.range.getRow() <= CONFIG.HEADER_ROW &&

    e.range.getLastRow() >= CONFIG.HEADER_ROW

  ) {

    clearInputHeaderCache_(sh);

    return;

  }



  const editStartRow =

    e.range.getRow();



  const editEndRow =

    e.range.getLastRow();



  const editStartCol =

    e.range.getColumn();



  const editEndCol =

    e.range.getLastColumn();



  if (

    editEndRow <=

    CONFIG.HEADER_ROW

  ) {

    return;

  }



  const startRow = Math.max(

    editStartRow,

    CONFIG.HEADER_ROW + 1

  );



  const numRows =

    editEndRow - startRow + 1;



  if (numRows < 1) return;



  const cols =

    getInputColumns_(sh);



  const now =

    new Date();





  // =====================================================

  // RAW NAME

  // =====================================================



  const touchesRaw =

    rangeTouchesColumn_(

      editStartCol,

      editEndCol,

      cols.RAW_NAME

    );



  if (touchesRaw) {



    /*

     * Luôn ghi Pending TRƯỚC.

     * Paste lớn sẽ không bị ép xử lý trong simple trigger onEdit.

     */

    addPendingRange_(

      startRow,

      editEndRow

    );



    /*

     * Edit nhỏ vẫn xử lý ngay như chức năng cũ.

     * forceUpdate = true vì Nickname đổi thì full SEO cũ

     * dù không trống vẫn có thể đã sai và phải cập nhật lại.

     */

    if (

      numRows <=

      CONFIG.ON_EDIT_IMMEDIATE_MAX_ROWS

    ) {

      try {



        fillSeoDateForRows_(

          sh,

          startRow,

          numRows,

          true,

          now,

          cols

        );



        removePendingRange_(

          startRow,

          editEndRow

        );



      } catch (error) {



        /*

         * Không remove Pending khi lỗi.

         * Fill blanks lần sau sẽ xử lý lại đúng range này.

         */

        console.log(

          "onEdit SEO error: " +

          error

        );

      }

    }

  }





  // =====================================================

  // SMART PENDING

  // =====================================================



  const touchesSeo =

    rangeTouchesColumn_(

      editStartCol,

      editEndCol,

      cols.SEO_NAME

    );



  const touchesUploadDate =

    rangeTouchesColumn_(

      editStartCol,

      editEndCol,

      cols.UPLOAD_DATE

    );



  if (

    !touchesRaw &&

    (

      touchesSeo ||

      touchesUploadDate

    )

  ) {

    addPendingRange_(

      startRow,

      editEndRow

    );

  }





  // =====================================================

  // REQUEST TECH + FINAL CHECK
  // =====================================================

  /*
   * DATE ENGINE đã tách sang:
   * DateStatus_RequestTech_CheckedTime_V2.gs
   *
   * SEO onEdit không cập nhật NGÀY RQ / Checked time nữa.
   * Installable trigger dateStatusOnEdit_ xử lý riêng.
   */


}





// ======================================================

// MENU: FILL BLANKS SEO + DATE

// ======================================================



function fillBlanksSeoDate() {

  const runStartedAt = Date.now();



  const lock =

    LockService

      .getDocumentLock();



  /*

   * Bản cũ chờ 3 giây rồi báo.

   * Giữ nguyên nguyên tắc lock, nhưng nếu đang bận thì

   * lưu việc để auto-resume thay vì tạo thêm execution nặng.

   */

  if (!lock.tryLock(1000)) {

    showSeoToast_(

      "Một tác vụ SEO khác đang chạy. Tiến độ vẫn được giữ.",

      "Fill blanks",

      5

    );



    // Không spam continuation khi lock đang bận.
    scheduleSeoWatchdog_(45000);

    return;

  }



  try {

    // Arm safety trigger TRƯỚC mọi thao tác nặng.
    // Nếu execution chết cứng, finally không chạy => watchdog còn sống.
    scheduleSeoWatchdog_();

    const sh = getInputSheet_();

    if (!sh) return;



    const cols = getInputColumns_(sh);

    const props =

      PropertiesService

        .getDocumentProperties();



    const isReady =

      props.getProperty(

        CONFIG.SMART_INDEX_READY_KEY

      ) === "1";



    // ===================================================

    // FIRST RUN / RESUME INITIAL FULL SCAN

    // ===================================================

    if (!isReady) {

      initializeSmartSeoIndex_(

        sh,

        cols,

        runStartedAt

      );

      return;

    }



    // ===================================================

    // NORMAL RUN

    // ===================================================

    const compiledRules =

      getCompiledSeoRules_();



    const now = new Date();



    let processedRows = 0;

    let processedBatches = 0;



    // ===================================================

    // 1. PROCESS PENDING RANGES

    // ===================================================

    while (

      processedBatches <

        CONFIG.SEO_MAX_BATCHES_PER_RUN &&

      !shouldStopSeoRun_(runStartedAt)

    ) {

      const pendingRanges =

        getPendingRanges_();



      if (!pendingRanges.length) {

        break;

      }



      const rangeStart =

        pendingRanges[0][0];



      const rangeEnd =

        pendingRanges[0][1];



      const batchEnd =

        Math.min(

          rangeEnd,

          rangeStart +

            CONFIG.SEO_BATCH_SIZE -

            1

        );



      const batchRows =

        batchEnd -

        rangeStart +

        1;



      processSeoDateRangeFast_(

        sh,

        rangeStart,

        batchRows,

        true,

        now,

        cols,

        compiledRules

      );



      /*

       * Chỉ xóa Pending sau khi batch thành công.

       */

      removePendingRange_(

        rangeStart,

        batchEnd

      );



      processedRows += batchRows;

      processedBatches++;

    }



    // ===================================================

    // 2. PROCESS NEW ROWS AFTER WATERMARK

    // ===================================================

    let lastIndexedRow =

      getLastIndexedRow_();



    const currentLastRawRow =

      getLastDataRowFast_(

        sh,

        cols.RAW_NAME

      );



    while (

      processedBatches <

        CONFIG.SEO_MAX_BATCHES_PER_RUN &&

      !shouldStopSeoRun_(runStartedAt) &&

      lastIndexedRow <

        currentLastRawRow

    ) {

      const batchStart =

        Math.max(

          lastIndexedRow + 1,

          CONFIG.HEADER_ROW + 1

        );



      const batchEnd =

        Math.min(

          currentLastRawRow,

          batchStart +

            CONFIG.SEO_BATCH_SIZE -

            1

        );



      const batchRows =

        batchEnd -

        batchStart +

        1;



      processSeoDateRangeFast_(

        sh,

        batchStart,

        batchRows,

        true,

        now,

        cols,

        compiledRules

      );



      setLastIndexedRow_(

        batchEnd

      );



      lastIndexedRow =

        batchEnd;



      processedRows += batchRows;

      processedBatches++;

    }



    // ===================================================

    // RESULT / AUTO RESUME

    // ===================================================

    const remainingPending =

      getPendingRanges_();



    const latestLastRawRow =

      getLastDataRowFast_(

        sh,

        cols.RAW_NAME

      );



    const stillHasNewRows =

      getLastIndexedRow_() <

      latestLastRawRow;



    if (

      remainingPending.length ||

      stillHasNewRows

    ) {

      if (CONFIG.SEO_AUTO_RESUME) {

        scheduleSeoContinuation_();

      }



      showSeoToast_(

        "Đã xử lý " +

          processedRows +

          " dòng. Đã nhớ tiến độ và sẽ tiếp tục.",

        "Fill blanks",

        5

      );



      return;

    }



    /*

     * Không còn việc thì dọn trigger SEO dư.

     */

    deleteSeoContinuationTriggers_();



    if (!processedRows) {

      showSeoToast_(

        "Không có dòng nào cần xử lý.",

        "Fill blanks",

        4

      );

      return;

    }



    showSeoToast_(

      "Hoàn tất. Đã kiểm tra/cập nhật " +

        processedRows +

        " dòng.",

      "Fill blanks",

      4

    );
  } catch (error) {
    markSeoScanError_(error, "FILL_BLANKS_OR_FULL_SCAN");
    console.error("[SEO ERROR] " + formatErrorForState_(error));
    showSeoToast_(
      "ERROR at row " + ((loadSeoScanState_() || {}).errorRow || "?") +
      " | " + shortErrorMessage_(error),
      "SEO",
      10
    );
  } finally {
    // Normal finish => dọn watchdog.
    // Hard-timeout/cancel cứng => finally không chạy, watchdog vẫn còn.
    deleteSeoWatchdogTriggers_();
    lock.releaseLock();
  }
}
// ======================================================

// FIRST FULL SCAN

// ======================================================



function initializeSmartSeoIndex_(

  sh,

  cols,

  runStartedAt

) {

  const props =

    PropertiesService

      .getDocumentProperties();



  const compiledRules =

    getCompiledSeoRules_();



  const now = new Date();



  // =====================================================

  // FREEZE LAST RAW ROW FOR THIS INITIAL FULL SCAN

  // =====================================================

  let currentLastRawRow =

    Number(

      props.getProperty(

        CONFIG.INIT_LAST_ROW_KEY

      )

    );



  if (

    !Number.isFinite(

      currentLastRawRow

    ) ||

    currentLastRawRow <

      CONFIG.HEADER_ROW

  ) {

    currentLastRawRow =

      getLastDataRowFast_(

        sh,

        cols.RAW_NAME

      );



    props.setProperty(

      CONFIG.INIT_LAST_ROW_KEY,

      String(

        currentLastRawRow

      )

    );

  }



  if (

    currentLastRawRow <=

    CONFIG.HEADER_ROW

  ) {

    setLastIndexedRow_(

      CONFIG.HEADER_ROW

    );



    clearSeoInitCheckpoint_();

    markSmartIndexReady_();

    markSeoScanDone_(currentLastRawRow);

    deleteSeoContinuationTriggers_();



    showSeoToast_(

      "Không có dữ liệu Nickname. Smart Index đã sẵn sàng.",

      "INPUT Tools",

      4

    );



    return;

  }



  // =====================================================

  // RESUME CURSOR

  // =====================================================

  let cursor =

    Number(

      props.getProperty(

        CONFIG.INIT_CURSOR_KEY

      )

    );



  if (

    !Number.isFinite(cursor) ||

    cursor <

      CONFIG.HEADER_ROW + 1

  ) {

    cursor =

      CONFIG.HEADER_ROW + 1;

  }



  let processedRows = 0;

  let processedBatches = 0;

  markSeoScanRunning_(cursor, currentLastRawRow);



  // =====================================================

  // FULL SCAN — GIỚI HẠN BATCH / EXECUTION

  // =====================================================

  while (

    cursor <= currentLastRawRow &&

    processedBatches <

      CONFIG.SEO_MAX_BATCHES_PER_RUN &&

    !shouldStopSeoRun_(runStartedAt)

  ) {

    const batchEnd =

      Math.min(

        currentLastRawRow,

        cursor +

          CONFIG.SEO_BATCH_SIZE -

          1

      );



    const batchRows =

      batchEnd -

      cursor +

      1;



    processSeoDateRangeFast_(

      sh,

      cursor,

      batchRows,

      true,

      now,

      cols,

      compiledRules

    );



    /*

     * Chỉ cập nhật checkpoint SAU khi batch thành công.

     */

    setLastIndexedRow_(

      batchEnd

    );



    cursor =

      batchEnd + 1;



    props.setProperty(

      CONFIG.INIT_CURSOR_KEY,

      String(cursor)

    );

    markSeoScanRunning_(cursor, currentLastRawRow);



    processedRows += batchRows;

    processedBatches++;

  }



  // =====================================================

  // CHƯA XONG => SAVE + AUTO RESUME

  // =====================================================

  if (

    cursor <=

    currentLastRawRow

  ) {

    if (CONFIG.SEO_AUTO_RESUME) {

      scheduleSeoContinuation_();

    }



    showSeoToast_(

      "Đã quét " +

        processedRows +

        " dòng. Đã nhớ tới dòng " +

        (cursor - 1) +

        " và sẽ tiếp tục.",

      "INPUT Tools",

      5

    );



    return;

  }



  // =====================================================

  // SMART INDEX READY

  // =====================================================

  clearSeoInitCheckpoint_();

  markSmartIndexReady_();

  markSeoScanDone_(currentLastRawRow);

  deleteSeoContinuationTriggers_();



  showSeoToast_(

    "Quét full hoàn tất đến dòng " +

      currentLastRawRow +

      ". Từ giờ chỉ xử lý dòng thay đổi hoặc dòng mới.",

    "INPUT Tools",

    6

  );

}





// ======================================================

// UPDATE SELECTED

// ======================================================




function hasSelectedSeoContinuationTrigger_() {
  const handler =
    CONFIG.SELECTED_SEO_CONTINUE_HANDLER;

  return ScriptApp
    .getProjectTriggers()
    .some(
      function(trigger) {
        return (
          trigger.getHandlerFunction() ===
          handler
        );
      }
    );
}


function isSeoExecutionReallyRunning_() {
  const lock =
    LockService.getDocumentLock();

  if (!lock.tryLock(250)) {
    return true;
  }

  try {
    return false;
  } finally {
    lock.releaseLock();
  }
}


function isSelectedSeoJobActivelyQueued_(job) {
  if (!job) return false;

  const ageMs =
    Date.now() -
    Number(
      job.updatedAt ||
      job.heartbeatAt ||
      job.startedAt ||
      0
    );

  if (
    job.status === "QUEUED" ||
    job.status === "WAITING"
  ) {
    return (
      (
        hasSelectedSeoContinuationTrigger_() ||
        hasSelectedSeoWatchdogTrigger_()
      ) &&
      ageMs >= 0 &&
      ageMs < 3 * 60 * 1000
    );
  }

  if (job.status === "RUNNING") {
    /*
     * RUNNING property không đủ.
     * Chỉ DocumentLock đang bị giữ mới chứng minh execution còn sống.
     */
    return isSeoExecutionReallyRunning_();
  }

  return false;
}


function clearSelectedSeoLease_() {
  PropertiesService
    .getDocumentProperties()
    .deleteProperty(
      CONFIG.SELECTED_SEO_LEASE_KEY
    );
}


function updateSelectedSeoDate() {
  const ss =
    SpreadsheetApp.getActiveSpreadsheet();

  rememberSeoSpreadsheet_(ss);

  const sh =
    ss.getActiveSheet();

  if (
    !sh ||
    sh.getName() !==
      CONFIG.INPUT_SHEET
  ) {
    showSeoToast_(
      'Hãy chọn vùng cần cập nhật trong sheet "' +
      CONFIG.INPUT_SHEET +
      '".',
      "SEO SELECTED",
      5
    );
    return;
  }

  const rg =
    sh.getActiveRange();

  if (!rg) return;

  const startRow =
    Math.max(
      rg.getRow(),
      CONFIG.HEADER_ROW + 1
    );

  const endRow =
    Math.min(
      rg.getLastRow(),
      Math.max(
        sh.getLastRow(),
        CONFIG.HEADER_ROW + 1
      )
    );

  if (endRow < startRow) {
    showSeoToast_(
      "Vùng chọn không có dòng dữ liệu.",
      "SEO SELECTED",
      5
    );
    return;
  }

  if (
    isSeoExecutionReallyRunning_()
  ) {
    const oldJob =
      loadSelectedSeoJob_();

    showSeoToast_(
      oldJob
        ? "SEO đang chạy thật | rows " +
          oldJob.startRow + ":" +
          oldJob.endRow +
          " | Last success " +
          oldJob.lastSuccessRow +
          " | Next " +
          oldJob.cursor
        : "Một tác vụ SEO khác đang chạy thật.",
      "SEO SELECTED",
      8
    );

    return;
  }

  const oldJob =
    loadSelectedSeoJob_();

  if (
    isSelectedSeoJobActivelyQueued_(
      oldJob
    )
  ) {
    showSeoToast_(
      "Selected SEO cũ chưa xong | " +
      oldJob.status +
      " rows " +
      oldJob.startRow + ":" +
      oldJob.endRow +
      " | Last success " +
      oldJob.lastSuccessRow +
      " | Next " +
      oldJob.cursor +
      ". Xem SEO processing status.",
      "SEO SELECTED",
      9
    );

    return;
  }

  deleteSelectedSeoContinuationTriggers_();
  deleteSelectedSeoWatchdogTriggers_();
  clearSelectedSeoLease_();

  const nowMs =
    Date.now();

  const job = {
    version: 8,
    token:
      Utilities.getUuid(),

    spreadsheetId:
      ss.getId(),

    sheetId:
      sh.getSheetId(),

    sheetName:
      sh.getName(),

    startRow:
      startRow,

    endRow:
      endRow,

    cursor:
      startRow,

    lastSuccessRow:
      startRow - 1,

    status:
      "QUEUED",

    mode:
      "SELECTED",

    phase:
      "QUEUED",

    startedAt:
      nowMs,

    updatedAt:
      nowMs,

    heartbeatAt:
      nowMs,

    nowMs:
      nowMs,

    checked: 0,
    matched: 0,
    seoFilled: 0,
    seoUpdated: 0,
    dateFilled: 0,
    noSourceSkipped: 0,
    batchesCompleted: 0,
    safetyResumeCount: 0,
    lastSafetyResumeAt: 0,

    lastWorkerOutcome: "QUEUED",
    lastBatchStart: 0,
    lastBatchEnd: 0,
    lastSeoWriteBlocks: 0,
    lastDateWriteBlocks: 0,

    errorPhase: "",
    errorRow: 0,
    errorMessage: ""
  };

  saveSelectedSeoJob_(
    job
  );

  try {
    scheduleSelectedSeoContinuation_();

  } catch (error) {
    job.status =
      "ERROR";

    job.phase =
      "SCHEDULE_ERROR";

    job.updatedAt =
      Date.now();

    job.heartbeatAt =
      job.updatedAt;

    job.errorPhase =
      "SCHEDULE_SELECTED_WORKER";

    job.errorRow =
      startRow;

    job.errorMessage =
      formatErrorForState_(
        error
      );

    saveSelectedSeoJob_(
      job
    );

    showSeoToast_(
      "Không tạo được worker SEO | " +
      shortErrorMessage_(
        error
      ),
      "SEO SELECTED",
      10
    );

    return;
  }

  showSeoToast_(
    "QUEUED rows " +
    startRow + ":" +
    endRow +
    ". Selection đã khóa. Có thể click sang ô khác.",
    "SEO SELECTED",
    7
  );
}


/*
 * Worker của Selected SEO.
 *
 * Mỗi execution chỉ xử lý 1 batch.
 * Không có while kéo dài.
 */
function processSelectedSeoDateJob_() {
  const seoLock =
    LockService.getDocumentLock();

  if (
    !seoLock.tryLock(750)
  ) {
    const waitingJob =
      loadSelectedSeoJob_();

    if (
      waitingJob &&
      (
        waitingJob.status ===
          "QUEUED" ||
        waitingJob.status ===
          "WAITING" ||
        waitingJob.status ===
          "RUNNING"
      )
    ) {
      /*
       * Nếu một worker khác thật sự đang RUNNING và đang giữ lock,
       * worker phụ KHÔNG được đổi state RUNNING thành WAITING.
       */
      if (
        waitingJob.status !==
          "RUNNING"
      ) {
        waitingJob.status =
          "WAITING";

        waitingJob.phase =
          "WAITING_SEO_LOCK";

        waitingJob.lastWorkerOutcome =
          "WAITING_LOCK";

        waitingJob.updatedAt =
          Date.now();

        waitingJob.heartbeatAt =
          waitingJob.updatedAt;

        saveSelectedSeoJobIfCurrent_(
          waitingJob
        );
      }

      try {
        // SEO khác đang giữ lock: không tạo chuỗi continue no-op.
        // Chỉ watchdog chờ lock rảnh rồi tự resume.
        deleteSelectedSeoContinuationTriggers_();
        scheduleSelectedSeoWatchdog_(45000);

      } catch (error) {
        /*
         * Chỉ ghi ERROR nếu job chưa có worker RUNNING thật.
         * Nếu RUNNING, execution đang giữ lock sẽ tự quyết định state.
         */
        if (
          waitingJob.status !==
            "RUNNING"
        ) {
          waitingJob.status =
            "ERROR";

          waitingJob.phase =
            "SCHEDULE_ERROR";

          waitingJob.errorPhase =
            "WAITING_SEO_LOCK";

          waitingJob.errorRow =
            Number(
              waitingJob.cursor
            ) ||
            Number(
              waitingJob.startRow
            );

          waitingJob.errorMessage =
            formatErrorForState_(
              error
            );

          waitingJob.updatedAt =
            Date.now();

          waitingJob.heartbeatAt =
            waitingJob.updatedAt;

          saveSelectedSeoJobIfCurrent_(
            waitingJob
          );
        }
      }
    }

    console.log(
      "[SEO SELECTED V9] WAITING_LOCK | watchdog armed | job=" +
      (waitingJob ? waitingJob.startRow + ":" + waitingJob.endRow : "none")
    );

    return;
  }

  let leaseToken = "";
  let job = null;
  let originalJobToken = "";
  let phase = "START_WORKER";
  let batchStart = 0;

  try {
    job =
      loadSelectedSeoJob_();

    if (
      !job ||
      (
        job.status !==
          "QUEUED" &&
        job.status !==
          "WAITING" &&
        job.status !==
          "RUNNING"
      )
    ) {
      deleteSelectedSeoContinuationTriggers_();
      return;
    }

    originalJobToken =
      job.token;

    leaseToken =
      acquireSelectedSeoLease_();

    if (!leaseToken) {
      clearSelectedSeoLease_();

      leaseToken =
        acquireSelectedSeoLease_();
    }

    if (!leaseToken) {
      throw new Error(
        "Không lấy được Selected SEO lease."
      );
    }

    batchStart =
      Math.max(
        Number(job.cursor) ||
        Number(job.startRow),
        Number(job.startRow)
      );

    console.log(
      "[SEO SELECTED V9] WORKER_START | range=" +
      job.startRow + ":" + job.endRow +
      " | cursor=" + batchStart +
      " | token=" + job.token
    );

    job.lastWorkerOutcome =
      "RUNNING";

    job.status =
      "RUNNING";

    job.phase =
      "OPEN_SHEET";

    job.updatedAt =
      Date.now();

    job.heartbeatAt =
      job.updatedAt;

    if (
      !saveSelectedSeoJobIfCurrent_(
        job
      )
    ) {
      return;
    }

    phase =
      "ARM_SAFETY_WATCHDOG";

    job.phase =
      phase;

    job.updatedAt =
      Date.now();

    job.heartbeatAt =
      job.updatedAt;

    saveSelectedSeoJobIfCurrent_(
      job
    );

    // Arm safety trigger trước open/read/rules/convert/write.
    scheduleSelectedSeoWatchdog_();

    phase =
      "OPEN_SHEET";

    const ss =
      SpreadsheetApp
        .openById(
          job.spreadsheetId
        );

    const sh =
      ss.getSheets()
        .find(
          function(sheet) {
            return (
              sheet.getSheetId() ===
              Number(job.sheetId)
            );
          }
        );

    if (!sh) {
      throw new Error(
        "Không tìm thấy sheetId " +
        job.sheetId +
        " của job Selected SEO."
      );
    }

    phase =
      "LOAD_HEADERS";

    job.phase =
      phase;

    job.updatedAt =
      Date.now();

    job.heartbeatAt =
      job.updatedAt;

    saveSelectedSeoJobIfCurrent_(
      job
    );

    const cols =
      getInputColumns_(
        sh
      );

    phase =
      "LOAD_SEO_RULES";

    job.phase =
      phase;

    job.updatedAt =
      Date.now();

    job.heartbeatAt =
      job.updatedAt;

    saveSelectedSeoJobIfCurrent_(
      job
    );

    console.log(
      "[SEO SELECTED V9] LOAD_RULES_BEGIN | cursor=" + batchStart
    );

    const compiledRules =
      getCompiledSeoRules_(
        ss
      );

    console.log(
      "[SEO SELECTED V9] LOAD_RULES_END | cursor=" + batchStart
    );

    batchStart =
      Math.max(
        Number(job.cursor) ||
        Number(job.startRow),
        Number(job.startRow)
      );

    if (
      batchStart >
      Number(job.endRow)
    ) {
      finishSelectedSeoJob_(
        job
      );
      return;
    }

    const batchSize =
      Number(
        CONFIG
          .SELECTED_SEO_BATCH_SIZE
      ) ||
      120;

    const batchRows =
      Math.min(
        batchSize,
        Number(job.endRow) -
          batchStart +
          1
      );

    const batchEnd =
      batchStart +
      batchRows -
      1;

    phase =
      "PROCESS_ROWS_" +
      batchStart +
      "_TO_" +
      batchEnd;

    job.phase =
      phase;

    job.updatedAt =
      Date.now();

    job.heartbeatAt =
      job.updatedAt;

    saveSelectedSeoJobIfCurrent_(
      job
    );

    renewSelectedSeoLease_(
      leaseToken
    );

    console.log(
      "[SEO SELECTED V9] BATCH_BEGIN | rows=" + batchStart + ":" + batchEnd
    );

    const stats =
      processSelectedSeoMicroBatch_(
        sh,
        batchStart,
        batchRows,
        new Date(
          Number(job.nowMs) ||
          Date.now()
        ),
        cols,
        compiledRules
      );

    console.log(
      "[SEO SELECTED V9] BATCH_END | rows=" + batchStart + ":" + batchEnd +
      " | checked=" + stats.checked +
      " | matched=" + stats.matched +
      " | seoFilled=" + stats.seoFilled +
      " | seoUpdated=" + stats.seoUpdated +
      " | dateFilled=" + stats.dateFilled +
      " | noSource=" + stats.noSourceSkipped +
      " | seoBlocks=" + Number(stats.seoWriteBlocks || 0) +
      " | dateBlocks=" + Number(stats.dateWriteBlocks || 0)
    );

    const liveJob =
      loadSelectedSeoJob_();

    if (
      !liveJob ||
      liveJob.token !==
        originalJobToken ||
      (
        liveJob.status !==
          "RUNNING" &&
        liveJob.status !==
          "WAITING" &&
        liveJob.status !==
          "QUEUED"
      )
    ) {
      return;
    }

    job.checked +=
      Number(
        stats.checked || 0
      );

    job.matched +=
      Number(
        stats.matched || 0
      );

    job.seoFilled +=
      Number(
        stats.seoFilled || 0
      );

    job.seoUpdated +=
      Number(
        stats.seoUpdated || 0
      );

    job.dateFilled +=
      Number(
        stats.dateFilled || 0
      );

    job.noSourceSkipped +=
      Number(
        stats.noSourceSkipped ||
        0
      );

    job.lastWorkerOutcome =
      "BATCH_OK";

    job.lastBatchStart =
      batchStart;

    job.lastBatchEnd =
      batchEnd;

    job.lastSeoWriteBlocks =
      Number(stats.seoWriteBlocks || 0);

    job.lastDateWriteBlocks =
      Number(stats.dateWriteBlocks || 0);

    job.lastSuccessRow =
      batchEnd;

    job.cursor =
      batchEnd + 1;

    job.batchesCompleted =
      Number(
        job.batchesCompleted ||
        0
      ) + 1;

    job.updatedAt =
      Date.now();

    job.heartbeatAt =
      job.updatedAt;

    job.errorPhase = "";
    job.errorRow = 0;
    job.errorMessage = "";

    if (
      Number(job.cursor) >
      Number(job.endRow)
    ) {
      finishSelectedSeoJob_(
        job
      );
      return;
    }

    job.status =
      "WAITING";

    job.phase =
      "WAITING_RESUME";

    if (
      !saveSelectedSeoJobIfCurrent_(
        job
      )
    ) {
      return;
    }

    scheduleSelectedSeoContinuation_();

    showSeoToast_(
      "WAITING | Last success " +
      job.lastSuccessRow +
      " | Next " +
      job.cursor +
      " | Range " +
      job.startRow +
      ":" +
      job.endRow,
      "SEO SELECTED",
      6
    );

  } catch (error) {
    const liveJob =
      loadSelectedSeoJob_();

    if (
      job &&
      liveJob &&
      liveJob.token ===
        originalJobToken
    ) {
      job.status =
        "ERROR";

      job.lastWorkerOutcome =
        "ERROR";

      job.phase =
        "ERROR";

      job.updatedAt =
        Date.now();

      job.heartbeatAt =
        job.updatedAt;

      job.errorPhase =
        phase;

      job.errorRow =
        batchStart ||
        Number(
          job.cursor
        ) ||
        Number(
          job.startRow
        );

      job.errorMessage =
        formatErrorForState_(
          error
        );

      saveSelectedSeoJobIfCurrent_(
        job
      );
    }

    deleteSelectedSeoContinuationTriggers_();

    console.error(
      "[SEO SELECTED ERROR] " +
      formatErrorForState_(
        error
      )
    );

    showSeoToast_(
      "SEO SELECTED ERROR | " +
      shortErrorMessage_(
        error
      ),
      "SEO SELECTED",
      10
    );

  } finally {
    // Normal finish => dọn watchdog.
    // Hard-timeout/cancel cứng => finally không chạy, watchdog vẫn tồn tại.
    deleteSelectedSeoWatchdogTriggers_();

    if (leaseToken) {
      releaseSelectedSeoLease_(
        leaseToken
      );
    }

    seoLock.releaseLock();
  }
}


/*
 * Giữ tên hàm cũ để trigger/code tham chiếu không vỡ.
 */
function processSelectedSeoDateJobCore_() {
  processSelectedSeoDateJob_();
}


/*
 * V5 — Selected-specific micro batch.
 *
 * Logic vẫn là:
 * - Nickname trống => SKIP hoàn toàn.
 * - SEO đúng => logical SKIP.
 * - SEO sai/thiếu => cập nhật.
 * - NGÀY UPLOAD trống => điền.
 * - NGÀY UPLOAD có => giữ nguyên.
 *
 * Tối ưu quan trọng:
 * Nếu trong batch có thay đổi, ghi cả block nhỏ 1 lần
 * thay vì gọi setValues nhiều block rời rạc.
 * Giá trị matched vẫn được giữ nguyên y hệt.
 */
function processSelectedSeoMicroBatch_(
  sh,
  startRow,
  numRows,
  now,
  cols,
  compiledRules
) {
  const stats = {
    checked: 0,
    matched: 0,
    seoFilled: 0,
    seoUpdated: 0,
    dateFilled: 0,
    noSourceSkipped: 0
  };

  if (numRows < 1) {
    return stats;
  }

  const minCol =
    Math.min(
      cols.RAW_NAME,
      cols.UPLOAD_DATE,
      cols.SEO_NAME
    );

  const maxCol =
    Math.max(
      cols.RAW_NAME,
      cols.UPLOAD_DATE,
      cols.SEO_NAME
    );

  const width =
    maxCol - minCol + 1;

  const values =
    sh.getRange(
      startRow,
      minCol,
      numRows,
      width
    ).getValues();

  const rawIndex =
    cols.RAW_NAME - minCol;

  const dateIndex =
    cols.UPLOAD_DATE - minCol;

  const seoIndex =
    cols.SEO_NAME - minCol;

  const seoOutput =
    new Array(numRows);

  const dateOutput =
    new Array(numRows);

  const seoChangedIndexes = [];
  const dateChangedIndexes = [];

  for (
    let i = 0;
    i < numRows;
    i++
  ) {
    const raw =
      String(
        values[i][rawIndex] ||
        ""
      ).trim();

    const currentDate =
      values[i][dateIndex];

    const currentSeo =
      String(
        values[i][seoIndex] ||
        ""
      );

    /*
     * Nickname trống => SKIP thật sự:
     * không ghi lại SEO và không ghi lại ngày.
     */
    if (!raw) {
      stats.noSourceSkipped++;
      continue;
    }

    stats.checked++;

    const expectedSeo =
      convertSeoNameFast_(
        raw,
        compiledRules
      );

    if (
      expectedSeo ===
      currentSeo
    ) {
      stats.matched++;

    } else {
      seoOutput[i] = [
        expectedSeo
      ];

      seoChangedIndexes.push(
        i
      );

      if (
        !currentSeo &&
        expectedSeo
      ) {
        stats.seoFilled++;

      } else {
        stats.seoUpdated++;
      }
    }

    if (!currentDate) {
      dateOutput[i] = [
        now
      ];

      dateChangedIndexes.push(
        i
      );

      stats.dateFilled++;
    }
  }

  /*
   * Chỉ ghi đúng block bị thay đổi.
   * Matched / No source không bị rewrite.
   *
   * Batch Selected chỉ 20 dòng nên số block tối đa được giới hạn,
   * tránh lặp lại lỗi timeout của batch 500 dòng.
   */
  const seoWriteBlocks =
    writeLocalColumnChanges_(
      sh,
      startRow,
      cols.SEO_NAME,
      seoOutput,
      seoChangedIndexes,
      null
    );

  const dateWriteBlocks =
    writeLocalColumnChanges_(
      sh,
      startRow,
      cols.UPLOAD_DATE,
      dateOutput,
      dateChangedIndexes,
      null
    );

  stats.seoWriteBlocks =
    Number(seoWriteBlocks || 0);

  stats.dateWriteBlocks =
    Number(dateWriteBlocks || 0);

  /*
   * Format ngày chỉ 1 call cho cả micro-batch,
   * thay vì setNumberFormat từng block.
   */
  if (
    dateChangedIndexes.length
  ) {
    sh.getRange(
      startRow,
      cols.UPLOAD_DATE,
      numRows,
      1
    ).setNumberFormat(
      "dd/MM/yyyy"
    );
  }

  return stats;
}



function finishSelectedSeoJob_(job) {
  const liveJob =
    loadSelectedSeoJob_();

  if (
    !liveJob ||
    liveJob.token !== job.token ||
    liveJob.status !== "RUNNING"
  ) {
    return;
  }

  job.status = "DONE";

  job.lastWorkerOutcome =
    "DONE";

  job.cursor =
    Number(job.endRow) + 1;

  job.lastSuccessRow =
    Number(job.endRow);

  job.updatedAt =
    Date.now();

  job.heartbeatAt =
    job.updatedAt;

  job.phase =
    "DONE";

  job.errorPhase = "";
  job.errorRow = 0;
  job.errorMessage = "";

  if (
    !saveSelectedSeoJobIfCurrent_(
      job
    )
  ) {
    return;
  }

  deleteSelectedSeoContinuationTriggers_();
  deleteSelectedSeoWatchdogTriggers_();

  showSeoToast_(
    "DONE rows " +
    job.startRow + ":" + job.endRow +
    " | Last success " +
    job.lastSuccessRow +
    " | Matched " +
    job.matched +
    " | SEO filled " +
    job.seoFilled +
    " | SEO updated " +
    job.seoUpdated +
    " | Date filled " +
    job.dateFilled +
    " | No source " +
    job.noSourceSkipped,
    "SEO SELECTED",
    9
  );
}


function loadSelectedSeoJob_() {
  const raw =
    PropertiesService
      .getDocumentProperties()
      .getProperty(
        CONFIG.SELECTED_SEO_JOB_KEY
      );

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(
      "[SEO SELECTED] Job parse error: " +
      error
    );
    return null;
  }
}


function saveSelectedSeoJob_(job) {
  PropertiesService
    .getDocumentProperties()
    .setProperty(
      CONFIG.SELECTED_SEO_JOB_KEY,
      JSON.stringify(job)
    );
}


/*
 * Chỉ save nếu job đang lưu vẫn là ĐÚNG token này
 * và vẫn đang RUNNING.
 *
 * Chặn execution cũ ghi đè job Selected mới.
 */
function saveSelectedSeoJobIfCurrent_(job) {
  const current =
    loadSelectedSeoJob_();

  if (
    !current ||
    current.token !== job.token
  ) {
    return false;
  }

  /*
   * Không cho execution cũ "hồi sinh" job đã kết thúc.
   */
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

  saveSelectedSeoJob_(job);
  return true;
}


function scheduleSelectedSeoContinuation_(delayMs) {
  const handler =
    CONFIG.SELECTED_SEO_CONTINUE_HANDLER;

  const exists =
    ScriptApp
      .getProjectTriggers()
      .some(
        function(trigger) {
          return (
            trigger.getHandlerFunction() ===
            handler
          );
        }
      );

  if (exists) {
    return;
  }

  const safeDelay =
    Math.max(
      1000,
      Number(delayMs) ||
      Number(
        CONFIG.SELECTED_SEO_CONTINUE_AFTER_MS
      ) ||
      5000
    );

  ScriptApp
    .newTrigger(handler)
    .timeBased()
    .after(safeDelay)
    .create();
}


/*
 * ======================================================
 * SELECTED SEO SAFETY WATCHDOG
 * ======================================================
 */
function hasSelectedSeoWatchdogTrigger_() {
  const handler =
    CONFIG.SELECTED_SEO_WATCHDOG_HANDLER;

  if (!handler) return false;

  return ScriptApp
    .getProjectTriggers()
    .some(
      function(trigger) {
        return (
          trigger.getHandlerFunction() ===
          handler
        );
      }
    );
}


function scheduleSelectedSeoWatchdog_(delayMs) {
  const handler =
    CONFIG.SELECTED_SEO_WATCHDOG_HANDLER;

  if (
    !handler ||
    hasSelectedSeoWatchdogTrigger_()
  ) {
    return;
  }

  ScriptApp
    .newTrigger(handler)
    .timeBased()
    .after(
      Math.max(
        1000,
        Number(delayMs) ||
        Number(
          CONFIG.SELECTED_SEO_WATCHDOG_AFTER_MS
        ) ||
        45000
      )
    )
    .create();
}


function deleteSelectedSeoWatchdogTriggers_() {
  const handler =
    CONFIG.SELECTED_SEO_WATCHDOG_HANDLER;

  if (!handler) return;

  ScriptApp
    .getProjectTriggers()
    .forEach(
      function(trigger) {
        if (
          trigger.getHandlerFunction() ===
          handler
        ) {
          ScriptApp.deleteTrigger(
            trigger
          );
        }
      }
    );
}


function watchdogSelectedSeoDate_() {
  deleteSelectedSeoWatchdogTriggers_();

  const job =
    loadSelectedSeoJob_();

  if (
    !job ||
    (
      job.status !== "QUEUED" &&
      job.status !== "WAITING" &&
      job.status !== "RUNNING"
    )
  ) {
    return;
  }

  if (
    isSeoExecutionReallyRunning_()
  ) {
    console.log(
      "[SEO SAFETY] Selected worker vẫn giữ lock. Retry sau 30s."
    );

    scheduleSelectedSeoWatchdog_(
      45000
    );

    return;
  }

  job.status =
    "WAITING";

  job.lastWorkerOutcome =
    "SAFETY_RESUME";

  job.phase =
    "SAFETY_RESUME";

  job.updatedAt =
    Date.now();

  job.heartbeatAt =
    job.updatedAt;

  job.safetyResumeCount =
    Number(
      job.safetyResumeCount || 0
    ) + 1;

  job.lastSafetyResumeAt =
    job.updatedAt;

  job.errorPhase = "";
  job.errorRow = 0;
  job.errorMessage = "";

  if (
    !saveSelectedSeoJobIfCurrent_(
      job
    )
  ) {
    return;
  }

  clearSelectedSeoLease_();

  console.log(
    "[SEO SAFETY] Resume Selected từ row " +
    job.cursor +
    " | lastSuccess=" +
    job.lastSuccessRow
  );

  processSelectedSeoDateJob_();
}


function continueSelectedSeoDate_() {
  console.log(
    "[SEO SELECTED V9] CONTINUE_TRIGGER_FIRED"
  );

  /*
   * One-shot trigger hiện tại được dọn trước.
   * Nếu chưa xong, process sẽ tự tạo trigger mới.
   */
  deleteSelectedSeoContinuationTriggers_();
  processSelectedSeoDateJob_();
}


function deleteSelectedSeoContinuationTriggers_() {
  const handler =
    CONFIG.SELECTED_SEO_CONTINUE_HANDLER;

  ScriptApp
    .getProjectTriggers()
    .forEach(
      function(trigger) {
        if (
          trigger.getHandlerFunction() ===
          handler
        ) {
          ScriptApp.deleteTrigger(
            trigger
          );
        }
      }
    );
}


/*
 * ======================================================
 * SELECTED SEO LEASE
 * ======================================================
 *
 * State RUNNING KHÔNG còn được dùng để chứng minh execution sống.
 * Chỉ lease còn hạn mới được coi là job đang chạy thật.
 */
function acquireSelectedSeoLease_() {
  const guard =
    LockService.getScriptLock();

  if (
    !guard.tryLock(
      CONFIG
        .SELECTED_SEO_LEASE_LOCK_WAIT_MS ||
      3000
    )
  ) {
    return "";
  }

  try {
    const props =
      PropertiesService
        .getDocumentProperties();

    const now =
      Date.now();

    const raw =
      props.getProperty(
        CONFIG.SELECTED_SEO_LEASE_KEY
      );

    if (raw) {
      try {
        const current =
          JSON.parse(raw);

        if (
          current &&
          current.token &&
          Number(current.expiresAt) > now
        ) {
          return "";
        }
      } catch (error) {
        // Lease hỏng => coi như stale.
      }
    }

    const token =
      Utilities.getUuid() +
      "_" +
      now;

    props.setProperty(
      CONFIG.SELECTED_SEO_LEASE_KEY,
      JSON.stringify({
        token: token,
        expiresAt:
          now +
          (
            CONFIG
              .SELECTED_SEO_LEASE_MS ||
            90000
          ),
        updatedAt: now
      })
    );

    return token;

  } finally {
    guard.releaseLock();
  }
}


function renewSelectedSeoLease_(
  token
) {
  if (!token) return false;

  const guard =
    LockService.getScriptLock();

  if (
    !guard.tryLock(
      CONFIG
        .SELECTED_SEO_LEASE_LOCK_WAIT_MS ||
      3000
    )
  ) {
    return false;
  }

  try {
    const props =
      PropertiesService
        .getDocumentProperties();

    const raw =
      props.getProperty(
        CONFIG.SELECTED_SEO_LEASE_KEY
      );

    if (!raw) {
      return false;
    }

    let current;

    try {
      current =
        JSON.parse(raw);
    } catch (error) {
      return false;
    }

    if (
      !current ||
      current.token !== token
    ) {
      return false;
    }

    const now =
      Date.now();

    current.expiresAt =
      now +
      (
        CONFIG.SELECTED_SEO_LEASE_MS ||
        90000
      );

    current.updatedAt =
      now;

    props.setProperty(
      CONFIG.SELECTED_SEO_LEASE_KEY,
      JSON.stringify(current)
    );

    return true;

  } finally {
    guard.releaseLock();
  }
}


function releaseSelectedSeoLease_(
  token
) {
  if (!token) return;

  const guard =
    LockService.getScriptLock();

  if (
    !guard.tryLock(
      CONFIG
        .SELECTED_SEO_LEASE_LOCK_WAIT_MS ||
      3000
    )
  ) {
    return;
  }

  try {
    const props =
      PropertiesService
        .getDocumentProperties();

    const raw =
      props.getProperty(
        CONFIG.SELECTED_SEO_LEASE_KEY
      );

    if (!raw) return;

    try {
      const current =
        JSON.parse(raw);

      if (
        current &&
        current.token === token
      ) {
        props.deleteProperty(
          CONFIG
            .SELECTED_SEO_LEASE_KEY
        );
      }
    } catch (error) {
      props.deleteProperty(
        CONFIG
          .SELECTED_SEO_LEASE_KEY
      );
    }

  } finally {
    guard.releaseLock();
  }
}


function getSelectedSeoLeaseState_() {
  const raw =
    PropertiesService
      .getDocumentProperties()
      .getProperty(
        CONFIG.SELECTED_SEO_LEASE_KEY
      );

  if (!raw) {
    return null;
  }

  try {
    const lease =
      JSON.parse(raw);

    if (
      !lease ||
      !lease.token ||
      Number(lease.expiresAt) <=
        Date.now()
    ) {
      return null;
    }

    return lease;

  } catch (error) {
    return null;
  }
}


function showSeoProcessingStatus() {
  const props =
    PropertiesService
      .getDocumentProperties();

  const selected =
    loadSelectedSeoJob_();

  const scan =
    loadSeoScanState_();

  const lease =
    getSelectedSeoLeaseState_();

  const initCursor =
    Number(
      props.getProperty(
        CONFIG.INIT_CURSOR_KEY
      )
    ) || 0;

  const initLastRow =
    Number(
      props.getProperty(
        CONFIG.INIT_LAST_ROW_KEY
      )
    ) || 0;

  const ready =
    props.getProperty(
      CONFIG.SMART_INDEX_READY_KEY
    ) === "1";

  const lines = [];

  lines.push("SEO PROCESSING STATUS");
  lines.push("");
  lines.push("=== SELECTED SEO ===");

  if (!selected) {
    lines.push("Status: NONE");
  } else {
    const nowMs = Date.now();
    const heartbeatAge =
      nowMs -
      Number(
        selected.heartbeatAt ||
        selected.updatedAt ||
        selected.startedAt ||
        0
      );

    const hasContinuation =
      hasSelectedSeoContinuationTrigger_();

    const hasSafetyWatchdog =
      hasSelectedSeoWatchdogTrigger_();

    let effectiveStatus =
      selected.status;

    if (
      selected.status === "RUNNING" &&
      !(
        lease &&
        isSeoExecutionReallyRunning_()
      )
    ) {
      effectiveStatus =
        "INTERRUPTED / STALE";
    }

    if (
      (
        selected.status === "QUEUED" ||
        selected.status === "WAITING"
      ) &&
      !hasContinuation &&
      !hasSafetyWatchdog &&
      heartbeatAge > 15000
    ) {
      effectiveStatus =
        "STALLED / NO TRIGGER";
    }

    lines.push(
      "Status: " +
      effectiveStatus
    );

    lines.push(
      "Saved state: " +
      selected.status
    );

    lines.push(
      "Phase: " +
      (
        selected.phase ||
        "-"
      )
    );

    lines.push(
      "Range: " +
      selected.startRow +
      ":" +
      selected.endRow
    );

    lines.push(
      "Last success row: " +
      selected.lastSuccessRow
    );

    lines.push(
      "Current / next row: " +
      selected.cursor
    );

    lines.push(
      "Checked: " +
      Number(selected.checked || 0)
    );

    lines.push(
      "Matched / skipped: " +
      (
        Number(selected.matched || 0) +
        Number(
          selected.noSourceSkipped ||
          0
        )
      )
    );

    lines.push(
      "SEO filled: " +
      Number(
        selected.seoFilled || 0
      )
    );

    lines.push(
      "SEO updated: " +
      Number(
        selected.seoUpdated || 0
      )
    );

    lines.push(
      "Upload date filled: " +
      Number(
        selected.dateFilled || 0
      )
    );

    lines.push(
      "No source skipped: " +
      Number(
        selected.noSourceSkipped || 0
      )
    );

    lines.push(
      "Batches completed: " +
      Number(
        selected.batchesCompleted || 0
      )
    );

    lines.push(
      "Last worker outcome: " +
      (selected.lastWorkerOutcome || "-")
    );

    lines.push(
      "Last batch: " +
      (Number(selected.lastBatchStart || 0)
        ? selected.lastBatchStart + ":" + selected.lastBatchEnd
        : "-")
    );

    lines.push(
      "Last SEO write blocks: " +
      Number(selected.lastSeoWriteBlocks || 0)
    );

    lines.push(
      "Last Date write blocks: " +
      Number(selected.lastDateWriteBlocks || 0)
    );

    lines.push(
      "Execution lease: " +
      (
        lease
          ? "ACTIVE"
          : "NOT ACTIVE"
      )
    );

    lines.push(
      "Continuation trigger: " +
      (
        hasContinuation
          ? "ACTIVE"
          : "NOT ACTIVE"
      )
    );

    lines.push(
      "Safety watchdog: " +
      (
        hasSafetyWatchdog
          ? "ARMED"
          : "NOT ARMED"
      )
    );

    lines.push(
      "Safety resumes: " +
      Number(
        selected.safetyResumeCount || 0
      )
    );

    if (
      selected.lastSafetyResumeAt
    ) {
      lines.push(
        "Last safety resume: " +
        formatSeoStateTime_(
          selected.lastSafetyResumeAt
        )
      );
    }

    lines.push(
      "Last updated: " +
      formatSeoStateTime_(
        selected.updatedAt
      )
    );

    lines.push(
      "Heartbeat age: " +
      Math.max(
        0,
        Math.floor(
          (
            Date.now() -
            Number(
              selected.heartbeatAt ||
              selected.updatedAt ||
              0
            )
          ) / 1000
        )
      ) +
      "s"
    );

    if (
      selected.errorMessage
    ) {
      lines.push(
        "ERROR phase: " +
        selected.errorPhase
      );

      lines.push(
        "ERROR row: " +
        selected.errorRow
      );

      lines.push(
        "ERROR: " +
        String(
          selected.errorMessage
        ).slice(0, 500)
      );
    }
  }

  lines.push("");
  lines.push("=== FULL SEO SCAN ===");

  const scanStatus =
    scan && scan.status
      ? scan.status
      : (
          ready
            ? "DONE / READY"
            : "NOT READY"
        );

  const scanEndRow =
    initLastRow ||
    Number(
      scan && scan.endRow
    ) ||
    0;

  const scanCursor =
    initCursor ||
    Number(
      scan && scan.cursor
    ) ||
    (
      CONFIG.HEADER_ROW + 1
    );

  lines.push(
    "Status: " +
    scanStatus
  );

  lines.push(
    "Safety watchdog: " +
    (
      hasSeoWatchdogTrigger_()
        ? "ARMED"
        : "NOT ARMED"
    )
  );

  if (
    scan &&
    scan.safetyResumeCount
  ) {
    lines.push(
      "Safety resumes: " +
      Number(
        scan.safetyResumeCount || 0
      )
    );
  }

  if (scanEndRow) {
    lines.push(
      "Last success row: " +
      Math.max(
        CONFIG.HEADER_ROW,
        scanCursor - 1
      )
    );

    lines.push(
      "Current / next row: " +
      scanCursor
    );

    lines.push(
      "End row: " +
      scanEndRow
    );
  }

  if (
    scan &&
    scan.lastSafetyResumeAt
  ) {
    lines.push(
      "Last safety resume: " +
      formatSeoStateTime_(
        scan.lastSafetyResumeAt
      )
    );
  }

  if (
    scan &&
    scan.updatedAt
  ) {
    lines.push(
      "Last updated: " +
      formatSeoStateTime_(
        scan.updatedAt
      )
    );
  }

  if (
    scan &&
    scan.errorMessage
  ) {
    lines.push(
      "ERROR phase: " +
      scan.errorPhase
    );

    lines.push(
      "ERROR row: " +
      scan.errorRow
    );

    lines.push(
      "ERROR: " +
      String(
        scan.errorMessage
      ).slice(0, 500)
    );
  }

  const plainText =
    lines.join("\n");

  console.log(
    "[SEO STATUS]\n" +
    plainText
  );

  /*
   * Dùng modeless dialog để không giữ execution chờ như alert().
   */
  try {
    const html =
      HtmlService
        .createHtmlOutput(
          "<div style=\"font-family:monospace;white-space:pre-wrap;padding:12px;line-height:1.5\">" +
          seoEscapeHtml_(
            plainText
          ) +
          "</div>"
        )
        .setWidth(520)
        .setHeight(560);

    SpreadsheetApp
      .getUi()
      .showModelessDialog(
        html,
        "SEO Processing Status"
      );

  } catch (error) {
    showSeoToast_(
      "SELECTED " +
      (
        selected
          ? selected.status +
            " | Last " +
            selected.lastSuccessRow +
            " | Next " +
            selected.cursor
          : "NONE"
      ) +
      " | FULL " +
      scanStatus,
      "SEO STATUS",
      10
    );
  }
}


function formatSeoStateTime_(
  value
) {
  const ms =
    Number(value) || 0;

  if (!ms) {
    return "-";
  }

  try {
    return Utilities.formatDate(
      new Date(ms),
      "Asia/Ho_Chi_Minh",
      "dd/MM/yyyy HH:mm:ss"
    );
  } catch (error) {
    return String(
      new Date(ms)
    );
  }
}


function seoEscapeHtml_(
  value
) {
  return String(
    value || ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#39;"
    );
}


function resetAndScanSeoFromStart() {
  const ss =
    SpreadsheetApp
      .getActiveSpreadsheet();

  const sh =
    ss.getSheetByName(
      CONFIG.INPUT_SHEET
    );

  if (!sh) return;

  const resetGuard =
    LockService
      .getDocumentLock();

  if (
    !resetGuard.tryLock(
      750
    )
  ) {
    showSeoToast_(
      "Một tác vụ SEO đang chạy thật. Không reset chồng. Xem SEO processing status.",
      "SEO RESET",
      8
    );
    return;
  }

  try {
    deleteSelectedSeoContinuationTriggers_();
    deleteSelectedSeoWatchdogTriggers_();
    deleteSeoWatchdogTriggers_();

    const selected =
      loadSelectedSeoJob_();

    if (
      selected &&
      (
        selected.status ===
          "QUEUED" ||
        selected.status ===
          "WAITING" ||
        selected.status ===
          "RUNNING"
      )
    ) {
      selected.status =
        "CANCELLED_BY_FULL_RESET";

      selected.phase =
        "CANCELLED_BY_FULL_RESET";

      selected.updatedAt =
        Date.now();

      selected.heartbeatAt =
        selected.updatedAt;

      selected.errorPhase = "";
      selected.errorRow = 0;
      selected.errorMessage = "";

      saveSelectedSeoJob_(
        selected
      );
    }

    clearSelectedSeoLease_();

    deleteSeoContinuationTriggers_();
    clearSeoRulesCache_();
    invalidateSeoSmartIndex_();
    clearPendingRanges_();

    const cols =
      getInputColumns_(
        sh
      );

    const lastRow =
      getLastDataRowFast_(
        sh,
        cols.RAW_NAME
      );

    saveSeoScanState_({
      version: 3,
      status: "QUEUED",
      mode:
        "RESET_FULL_SCAN",
      startRow:
        CONFIG.HEADER_ROW + 1,
      endRow:
        lastRow,
      cursor:
        CONFIG.HEADER_ROW + 1,
      lastSuccessRow:
        CONFIG.HEADER_ROW,
      startedAt:
        Date.now(),
      updatedAt:
        Date.now(),
      errorPhase: "",
      errorRow: 0,
      errorMessage: ""
    });

    showSeoToast_(
      "Reset hoàn tất. Full SEO sẽ kiểm tra lại từ row 2 đến row " +
      lastRow +
      ". Dòng đúng SKIP; chỉ sai/thiếu mới ghi.",
      "SEO RESET",
      7
    );

  } finally {
    resetGuard.releaseLock();
  }

  fillBlanksSeoDate();
}


function loadSeoScanState_() {
  const raw = PropertiesService.getDocumentProperties().getProperty(CONFIG.SEO_SCAN_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}


function saveSeoScanState_(state) {
  PropertiesService.getDocumentProperties().setProperty(
    CONFIG.SEO_SCAN_STATE_KEY,
    JSON.stringify(state)
  );
}


function markSeoScanRunning_(cursor, endRow) {
  const state = loadSeoScanState_() || {
    version: 2,
    mode: "FULL_SCAN",
    startRow: CONFIG.HEADER_ROW + 1,
    startedAt: Date.now()
  };
  state.status = "RUNNING";
  state.cursor = Number(cursor) || (CONFIG.HEADER_ROW + 1);
  state.lastSuccessRow = Math.max(CONFIG.HEADER_ROW, state.cursor - 1);
  state.endRow = Number(endRow) || state.endRow || 0;
  state.updatedAt = Date.now();
  state.errorPhase = "";
  state.errorRow = 0;
  state.errorMessage = "";
  saveSeoScanState_(state);
}


function markSeoScanDone_(lastRow) {
  const state = loadSeoScanState_() || {
    version: 2,
    mode: "FULL_SCAN",
    startRow: CONFIG.HEADER_ROW + 1,
    startedAt: Date.now()
  };
  state.status = "DONE";
  state.endRow = Number(lastRow) || state.endRow || CONFIG.HEADER_ROW;
  state.cursor = state.endRow + 1;
  state.lastSuccessRow = state.endRow;
  state.updatedAt = Date.now();
  state.errorPhase = "";
  state.errorRow = 0;
  state.errorMessage = "";
  saveSeoScanState_(state);
}


function markSeoScanError_(error, phase) {
  const props = PropertiesService.getDocumentProperties();
  const state = loadSeoScanState_() || {
    version: 2,
    mode: "FULL_SCAN",
    startRow: CONFIG.HEADER_ROW + 1,
    startedAt: Date.now()
  };
  const cursor = Number(props.getProperty(CONFIG.INIT_CURSOR_KEY)) || state.cursor || (CONFIG.HEADER_ROW + 1);
  state.status = "ERROR";
  state.cursor = cursor;
  state.lastSuccessRow = Math.max(CONFIG.HEADER_ROW, cursor - 1);
  state.errorRow = cursor;
  state.errorPhase = phase || "FULL_SCAN";
  state.errorMessage = formatErrorForState_(error);
  state.updatedAt = Date.now();
  saveSeoScanState_(state);
}


function formatErrorForState_(error) {
  if (!error) return "Unknown error";
  return String(error.stack || error.message || error).slice(0, 1200);
}


function shortErrorMessage_(error) {
  return String((error && (error.message || error)) || "Unknown error").replace(/\s+/g, " ").slice(0, 180);
}


// ======================================================


// FAST SEO + DATE RANGE ENGINE

// ======================================================



function fillSeoDateForRows_(

  sh,

  startRow,

  numRows,

  forceUpdate,

  now,

  cols

) {

  if (numRows < 1) {

    return;

  }



  cols =

    cols ||

    getInputColumns_(sh);



  const compiledRules =

    getCompiledSeoRules_();



  processSeoDateRangeFast_(

    sh,

    startRow,

    numRows,

    forceUpdate,

    now,

    cols,

    compiledRules

  );

}





function processSeoDateRangeFast_(
  sh,
  startRow,
  numRows,
  forceUpdate,
  now,
  cols,
  compiledRules
) {
  const stats = {
    checked: 0,
    matched: 0,
    seoFilled: 0,
    seoUpdated: 0,
    dateFilled: 0,
    noSourceSkipped: 0
  };

  if (numRows < 1) return stats;

  const minCol = Math.min(cols.RAW_NAME, cols.UPLOAD_DATE, cols.SEO_NAME);
  const maxCol = Math.max(cols.RAW_NAME, cols.UPLOAD_DATE, cols.SEO_NAME);
  const width = maxCol - minCol + 1;

  const values = sh.getRange(startRow, minCol, numRows, width).getValues();

  const rawIndex = cols.RAW_NAME - minCol;
  const dateIndex = cols.UPLOAD_DATE - minCol;
  const seoIndex = cols.SEO_NAME - minCol;

  compiledRules = compiledRules || getCompiledSeoRules_();
  now = now || new Date();

  const seoOutput = new Array(numRows);
  const dateOutput = new Array(numRows);
  const seoChangedIndexes = [];
  const dateChangedIndexes = [];

  for (let i = 0; i < numRows; i++) {
    const raw = String(values[i][rawIndex] || "").trim();
    const currentDate = values[i][dateIndex];
    const currentSeo = String(values[i][seoIndex] || "");

    // Nickname trống => SKIP hoàn toàn.
    // Không xóa full SEO cũ, không xóa/nghi ngày upload.
    if (!raw) {
      stats.noSourceSkipped++;
      continue;
    }

    stats.checked++;

    let expectedSeo = currentSeo;
    if (forceUpdate || !currentSeo) {
      expectedSeo = convertSeoNameFast_(raw, compiledRules);
    }

    if (expectedSeo === currentSeo) {
      stats.matched++;
    } else {
      seoOutput[i] = [expectedSeo];
      seoChangedIndexes.push(i);

      if (!currentSeo && expectedSeo) {
        stats.seoFilled++;
      } else {
        stats.seoUpdated++;
      }
    }

    if (!currentDate) {
      dateOutput[i] = [now];
      dateChangedIndexes.push(i);
      stats.dateFilled++;
    }
  }

  writeLocalColumnChanges_(
    sh,
    startRow,
    cols.SEO_NAME,
    seoOutput,
    seoChangedIndexes,
    null
  );

  writeLocalColumnChanges_(
    sh,
    startRow,
    cols.UPLOAD_DATE,
    dateOutput,
    dateChangedIndexes,
    "dd/MM/yyyy"
  );

  return stats;
}


function writeLocalColumnChanges_(
  sh,
  baseStartRow,
  column,
  output,
  changedLocalIndexes,
  numberFormat
) {
  if (!changedLocalIndexes || !changedLocalIndexes.length) return 0;

  const blocks = [];
  let blockStart = changedLocalIndexes[0];
  let previous = changedLocalIndexes[0];

  for (let i = 1; i < changedLocalIndexes.length; i++) {
    const current = changedLocalIndexes[i];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    blocks.push([blockStart, previous]);
    blockStart = current;
    previous = current;
  }
  blocks.push([blockStart, previous]);

  for (let b = 0; b < blocks.length; b++) {
    const localStart = blocks[b][0];
    const localEnd = blocks[b][1];
    const length = localEnd - localStart + 1;
    const blockValues = [];

    for (let i = localStart; i <= localEnd; i++) {
      blockValues.push(output[i]);
    }

    const range = sh.getRange(baseStartRow + localStart, column, length, 1);
    range.setValues(blockValues);
    if (numberFormat) {
      range.setNumberFormat(numberFormat);
    }
  }

  return blocks.length;
}


// ======================================================


// SEO INITIAL SCAN CHECKPOINT HELPERS

// ======================================================



function clearSeoInitCheckpoint_() {

  const props =

    PropertiesService

      .getDocumentProperties();



  props.deleteProperty(

    CONFIG.INIT_CURSOR_KEY

  );



  props.deleteProperty(

    CONFIG.INIT_LAST_ROW_KEY

  );

}





function invalidateSeoSmartIndex_() {

  const props =

    PropertiesService

      .getDocumentProperties();



  props.deleteProperty(

    CONFIG.SMART_INDEX_READY_KEY

  );



  props.deleteProperty(

    CONFIG.LAST_INDEXED_ROW_KEY

  );



  props.deleteProperty(

    CONFIG.INIT_CURSOR_KEY

  );



  props.deleteProperty(

    CONFIG.INIT_LAST_ROW_KEY

  );



  /*

   * Không xóa Pending.

   * Không sửa bất kỳ dữ liệu nào trong INPUT.

   */

}





// ======================================================

// SMART INDEX ENGINE

// ======================================================



function markSmartIndexReady_() {

  PropertiesService

    .getDocumentProperties()

    .setProperty(

      CONFIG.SMART_INDEX_READY_KEY,

      "1"

    );

}





/*

 * Lưu watermark: dòng cuối cùng đã được Smart Index kiểm tra.

 */

function setLastIndexedRow_(

  row

) {

  const safeRow =

    Math.max(

      Number(row) ||

        CONFIG.HEADER_ROW,

      CONFIG.HEADER_ROW

    );



  PropertiesService

    .getDocumentProperties()

    .setProperty(

      CONFIG.LAST_INDEXED_ROW_KEY,

      String(

        Math.floor(

          safeRow

        )

      )

    );

}





/*

 * Đọc watermark.

 *

 * Nếu đang nâng cấp từ code cũ:

 *

 * READY có thể đã tồn tại,

 * nhưng LAST_INDEXED_ROW chưa tồn tại.

 *

 * Khi đó trả HEADER_ROW.

 *

 * Fill blanks sẽ index lại 1 lần.

 */

function getLastIndexedRow_() {

  const raw =

    PropertiesService

      .getDocumentProperties()

      .getProperty(

        CONFIG.LAST_INDEXED_ROW_KEY

      );



  const row =

    Number(raw);



  if (

    !Number.isFinite(row) ||

    row <

      CONFIG.HEADER_ROW

  ) {

    return CONFIG.HEADER_ROW;

  }



  return Math.floor(

    row

  );

}





/*

 * Lấy nhanh dòng cuối có dữ liệu

 * trong một cột.

 *

 * Không đọc toàn bộ cột vào RAM.

 *

 * Tương đương Ctrl + Up từ cuối sheet.

 */

function getLastDataRowFast_(

  sh,

  column

) {

  if (!sh) {
    throw new Error("getLastDataRowFast_: sheet không hợp lệ.");
  }

  column = Number(column);

  if (!Number.isFinite(column) || column < 1 || column > sh.getMaxColumns()) {
    throw new Error(
      "getLastDataRowFast_: column không hợp lệ: " + column
    );
  }

  column = Math.floor(column);

  const maxRows =

    sh.getMaxRows();



  if (

    maxRows <=

    CONFIG.HEADER_ROW

  ) {

    return CONFIG.HEADER_ROW;

  }



  const lastCell =

    sh.getRange(

      maxRows,

      column

    )

      .getNextDataCell(

        SpreadsheetApp

          .Direction

          .UP

      );



  const row =

    lastCell.getRow();



  if (

    row <=

    CONFIG.HEADER_ROW

  ) {

    return CONFIG.HEADER_ROW;

  }



  const value =

    String(

      lastCell

        .getDisplayValue() ||

      ""

    ).trim();



  return value

    ? row

    : CONFIG.HEADER_ROW;

}





/*

 * Lấy pending ranges hiện tại.

 */

function getPendingRanges_() {

  const props =

    PropertiesService

      .getDocumentProperties();



  const raw =

    props.getProperty(

      CONFIG.PENDING_RANGES_KEY

    );



  if (!raw) {

    return [];

  }



  try {



    const parsed =

      JSON.parse(raw);



    if (!Array.isArray(parsed)) {

      return [];

    }



    return normalizePendingRanges_(

      parsed

    );



  } catch (error) {



    console.log(

      "Cannot parse pending rows: " +

      error

    );



    return [];

  }

}





/*

 * Thêm một range vào Pending.

 */

function addPendingRange_(

  startRow,

  endRow

) {

  startRow = Math.max(

    Number(startRow) || 0,

    CONFIG.HEADER_ROW + 1

  );



  endRow =

    Number(endRow) || startRow;



  if (endRow < startRow) {

    return;

  }



  const ranges =

    getPendingRanges_();



  ranges.push([

    startRow,

    endRow

  ]);



  savePendingRanges_(

    normalizePendingRanges_(

      ranges

    )

  );

}





/*

 * Lấy snapshot Pending

 * rồi clear storage.

 */

function takePendingRanges_() {

  const ranges =

    getPendingRanges_();



  clearPendingRanges_();



  return ranges;

}





/*

 * Restore Pending nếu Fill blanks lỗi.

 */

function restorePendingRanges_(

  oldRanges

) {

  if (

    !oldRanges ||

    !oldRanges.length

  ) {

    return;

  }



  const current =

    getPendingRanges_();



  const merged =

    current.concat(

      oldRanges

    );



  savePendingRanges_(

    normalizePendingRanges_(

      merged

    )

  );

}





/*

 * Xóa vùng đã xử lý khỏi Pending.

 */

function removePendingRange_(

  removeStart,

  removeEnd

) {

  const ranges =

    getPendingRanges_();



  if (!ranges.length) {

    return;

  }



  const output = [];



  for (

    let i = 0;

    i < ranges.length;

    i++

  ) {



    const start =

      ranges[i][0];



    const end =

      ranges[i][1];





    if (

      end < removeStart ||

      start > removeEnd

    ) {

      output.push([

        start,

        end

      ]);



      continue;

    }





    if (start < removeStart) {

      output.push([

        start,

        removeStart - 1

      ]);

    }





    if (end > removeEnd) {

      output.push([

        removeEnd + 1,

        end

      ]);

    }

  }



  savePendingRanges_(

    normalizePendingRanges_(

      output

    )

  );

}





/*

 * Gom các row/range liền nhau.

 */

function normalizePendingRanges_(

  ranges

) {

  if (

    !ranges ||

    !ranges.length

  ) {

    return [];

  }



  const clean = [];



  for (

    let i = 0;

    i < ranges.length;

    i++

  ) {



    if (

      !Array.isArray(ranges[i]) ||

      ranges[i].length < 2

    ) {

      continue;

    }



    let start =

      Number(ranges[i][0]);



    let end =

      Number(ranges[i][1]);



    if (

      !Number.isFinite(start) ||

      !Number.isFinite(end)

    ) {

      continue;

    }



    start = Math.max(

      Math.floor(start),

      CONFIG.HEADER_ROW + 1

    );



    end =

      Math.floor(end);



    if (end < start) {

      continue;

    }



    clean.push([

      start,

      end

    ]);

  }





  if (!clean.length) {

    return [];

  }





  clean.sort(

    (a, b) =>

      a[0] - b[0]

  );





  const merged = [

    clean[0].slice()

  ];





  for (

    let i = 1;

    i < clean.length;

    i++

  ) {



    const current =

      clean[i];



    const last =

      merged[

        merged.length - 1

      ];





    if (

      current[0] <=

      last[1] + 1

    ) {



      last[1] = Math.max(

        last[1],

        current[1]

      );



    } else {



      merged.push(

        current.slice()

      );

    }

  }



  return merged;

}





/*

 * Lưu Pending.

 */

function savePendingRanges_(

  ranges

) {

  const props =

    PropertiesService

      .getDocumentProperties();



  if (

    !ranges ||

    !ranges.length

  ) {



    props.deleteProperty(

      CONFIG.PENDING_RANGES_KEY

    );



    return;

  }



  props.setProperty(

    CONFIG.PENDING_RANGES_KEY,

    JSON.stringify(ranges)

  );

}





function clearPendingRanges_() {

  PropertiesService

    .getDocumentProperties()

    .deleteProperty(

      CONFIG.PENDING_RANGES_KEY

    );

}





// ======================================================

// FILL MISSING UPLOAD DATES

// ======================================================



function fillMissingUploadDates() {

  const sh =

    getInputSheet_();



  if (!sh) return;



  const cols =

    getInputColumns_(sh);



  const sheetLastRow =

    sh.getLastRow();



  if (

    sheetLastRow <=

    CONFIG.HEADER_ROW

  ) {

    return;

  }



  const startRow =

    CONFIG.HEADER_ROW + 1;



  const possibleRows =

    sheetLastRow -

    CONFIG.HEADER_ROW;



  const minCol = Math.min(

    cols.RAW_NAME,

    cols.UPLOAD_DATE

  );



  const maxCol = Math.max(

    cols.RAW_NAME,

    cols.UPLOAD_DATE

  );



  const width =

    maxCol -

    minCol +

    1;



  const values =

    sh.getRange(

      startRow,

      minCol,

      possibleRows,

      width

    ).getValues();



  const rawIndex =

    cols.RAW_NAME -

    minCol;



  const dateIndex =

    cols.UPLOAD_DATE -

    minCol;





  let lastDataIndex = -1;



  for (

    let i = values.length - 1;

    i >= 0;

    i--

  ) {



    const raw =

      String(

        values[i][rawIndex] || ""

      ).trim();



    if (raw !== "") {

      lastDataIndex = i;

      break;

    }

  }



  if (lastDataIndex < 0) {

    return;

  }



  const actualRows =

    lastDataIndex + 1;



  const output =

    new Array(actualRows);



  const now =

    new Date();



  let hasChanges = false;





  for (

    let i = 0;

    i < actualRows;

    i++

  ) {



    const raw =

      String(

        values[i][rawIndex] || ""

      ).trim();



    const oldDate =

      values[i][dateIndex];
    if (!raw) {
      // Nickname trống => không cập nhật, giữ nguyên ngày hiện có.
      output[i] = [oldDate];
      continue;
    }





    if (oldDate) {



      output[i] = [

        oldDate

      ];



      continue;

    }





    output[i] = [

      now

    ];



    hasChanges = true;

  }





  if (!hasChanges) {

    return;

  }





  const dateRange =

    sh.getRange(

      startRow,

      cols.UPLOAD_DATE,

      actualRows,

      1

    );



  dateRange.setValues(

    output

  );



  dateRange.setNumberFormat(

    "dd/MM/yyyy"

  );

}





// ======================================================

// RQ + CHECKED MENU FUNCTIONS

// ======================================================



function fillMissingRqTeamTechDates() {

  const sh =

    getInputSheet_();



  if (!sh) return;



  const cols =

    getInputColumns_(sh);



  fillDoneDatesByColumn_(

    sh,

    cols.RQ_STATUS,

    cols.RQ_DATE,

    "dd/MM/yyyy"

  );

}





function fillMissingCheckedDates() {

  const sh =

    getInputSheet_();



  if (!sh) return;



  const cols =

    getInputColumns_(sh);



  fillDoneDatesByColumn_(

    sh,

    cols.CHECK_STATUS,

    cols.CHECK_DATE,

    "dd/MM/yyyy HH:mm"

  );

}





// ======================================================

// UPDATE SELECTED RQ / CHECKED DATES

// ======================================================



function updateSelectedRqTeamTechDates() {

  updateSelectedDoneDate_(

    "RQ Team Tech",

    "RQ_STATUS",

    "RQ_DATE",

    "dd/MM/yyyy"

  );

}





function updateSelectedCheckedDates() {

  updateSelectedDoneDate_(

    "Checked Date",

    "CHECK_STATUS",

    "CHECK_DATE",

    "dd/MM/yyyy HH:mm"

  );

}





function updateSelectedDoneDate_(title, statusKey, dateKey, numberFormat) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getActiveSheet();
  if (!sh || sh.getName() !== CONFIG.INPUT_SHEET) {
    showSeoToast_('Hãy chọn dòng trong sheet "' + CONFIG.INPUT_SHEET + '".', title, 5);
    return;
  }
  const rg = sh.getActiveRange();
  if (!rg) return;
  const startRow = Math.max(rg.getRow(), CONFIG.HEADER_ROW + 1);
  const endRow = rg.getLastRow();
  if (endRow < startRow) {
    showSeoToast_("Vùng chọn không có dữ liệu cần cập nhật.", title, 4);
    return;
  }
  const job = { spreadsheetId:ss.getId(), sheetId:sh.getSheetId(), startRow:startRow, endRow:endRow, cursor:startRow, title:title, statusKey:statusKey, dateKey:dateKey, numberFormat:numberFormat, updatedRows:0, nowMs:Date.now() };
  saveSelectedDateJob_(job);
  deleteSelectedDateContinuationTriggers_();
  processSelectedDateJob_();
}

function processSelectedDateJob_() {
  const props = PropertiesService.getDocumentProperties();
  const rawJob = props.getProperty(CONFIG.SELECTED_DATE_JOB_KEY);
  if (!rawJob) { deleteSelectedDateContinuationTriggers_(); return; }
  let job;
  try { job = JSON.parse(rawJob); } catch (error) { props.deleteProperty(CONFIG.SELECTED_DATE_JOB_KEY); deleteSelectedDateContinuationTriggers_(); throw error; }
  const ss = SpreadsheetApp.openById(job.spreadsheetId);
  const sh = ss.getSheets().find(sheet => sheet.getSheetId() === Number(job.sheetId));
  if (!sh) { props.deleteProperty(CONFIG.SELECTED_DATE_JOB_KEY); deleteSelectedDateContinuationTriggers_(); return; }
  const cols = getInputColumns_(sh);
  const statusCol = cols[job.statusKey];
  const dateCol = cols[job.dateKey];
  const batchSize = CONFIG.SELECTED_DATE_BATCH_SIZE || 100;
  const batchStart = Math.max(Number(job.cursor) || job.startRow, job.startRow);
  if (batchStart > job.endRow) { finishSelectedDateJob_(job); return; }
  const batchRows = Math.min(batchSize, job.endRow - batchStart + 1);
  const statuses = sh.getRange(batchStart, statusCol, batchRows, 1).getDisplayValues();
  const dateRange = sh.getRange(batchStart, dateCol, batchRows, 1);
  const oldDates = dateRange.getValues();
  const output = new Array(batchRows);
  const now = new Date(Number(job.nowMs) || Date.now());
  let batchChanged = false;
  let batchUpdated = 0;
  for (let i = 0; i < batchRows; i++) {
    const sheetRow = batchStart + i;
    const oldDate = oldDates[i][0];
    if (sh.isRowHiddenByFilter(sheetRow)) { output[i] = [oldDate]; continue; }
    if (containsDoneWord_(statuses[i][0])) { output[i] = [now]; batchUpdated++; batchChanged = true; }
    else { output[i] = [oldDate]; }
  }
  if (batchChanged) { dateRange.setValues(output); dateRange.setNumberFormat(job.numberFormat); }
  job.updatedRows = (Number(job.updatedRows) || 0) + batchUpdated;
  job.cursor = batchStart + batchRows;
  if (job.cursor <= job.endRow) {
    saveSelectedDateJob_(job);
    scheduleSelectedDateContinuation_();
    showSeoToast_("Đã xử lý tới dòng " + (job.cursor - 1) + ". Phần còn lại đã nhớ tiến độ và sẽ tự chạy tiếp.", job.title, 5);
    return;
  }
  finishSelectedDateJob_(job);
}

function finishSelectedDateJob_(job) {
  PropertiesService.getDocumentProperties().deleteProperty(CONFIG.SELECTED_DATE_JOB_KEY);
  deleteSelectedDateContinuationTriggers_();
  const updatedRows = Number(job.updatedRows) || 0;
  if (!updatedRows) { showSeoToast_("Không có dòng đang hiển thị nào trong vùng chọn có DONE.", job.title, 5); return; }
  showSeoToast_("Đã cập nhật " + updatedRows + " dòng đang hiển thị trong vùng chọn.", job.title, 5);
}

function saveSelectedDateJob_(job) {
  PropertiesService.getDocumentProperties().setProperty(CONFIG.SELECTED_DATE_JOB_KEY, JSON.stringify(job));
}

function scheduleSelectedDateContinuation_() {
  const handler = CONFIG.SELECTED_DATE_CONTINUE_HANDLER;
  const exists = ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === handler);
  if (exists) return;
  ScriptApp.newTrigger(handler).timeBased().after(CONFIG.SELECTED_DATE_CONTINUE_AFTER_MS || 60000).create();
}

function continueSelectedDateUpdate_() {
  deleteSelectedDateContinuationTriggers_();
  processSelectedDateJob_();
}

function deleteSelectedDateContinuationTriggers_() {
  const handler = CONFIG.SELECTED_DATE_CONTINUE_HANDLER;
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger);
  });
}


// ======================================================



// ======================================================
// RELOAD REQUEST TECH + FINAL CHECK — FULL SHEET
// ======================================================

function reloadRequestTechFinalCheck() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.INPUT_SHEET);
  if (!sh) return;

  const lastRow = sh.getLastRow();
  if (lastRow <= CONFIG.HEADER_ROW) {
    showSeoToast_("Sheet INPUT chưa có dữ liệu để reload.", "Reload Date", 4);
    return;
  }

  const job = { spreadsheetId: ss.getId(), sheetId: sh.getSheetId(), startRow: CONFIG.HEADER_ROW + 1, lastRow: lastRow, cursor: CONFIG.HEADER_ROW + 1, nowMs: Date.now(), processedRows: 0 };
  saveDateReloadJob_(job);
  deleteDateReloadContinuationTriggers_();
  processDateReloadJob_();
}

function processDateReloadJob_() {
  const props = PropertiesService.getDocumentProperties();
  const rawJob = props.getProperty(CONFIG.DATE_RELOAD_JOB_KEY);
  if (!rawJob) { deleteDateReloadContinuationTriggers_(); return; }

  let job;
  try { job = JSON.parse(rawJob); }
  catch (error) { props.deleteProperty(CONFIG.DATE_RELOAD_JOB_KEY); deleteDateReloadContinuationTriggers_(); throw error; }

  const ss = SpreadsheetApp.openById(job.spreadsheetId);
  const sh = ss.getSheets().find(sheet => sheet.getSheetId() === Number(job.sheetId));
  if (!sh) { props.deleteProperty(CONFIG.DATE_RELOAD_JOB_KEY); deleteDateReloadContinuationTriggers_(); return; }

  const cols = getInputColumns_(sh);
  const batchSize = CONFIG.DATE_RELOAD_BATCH_SIZE || 1000;
  const maxBatches = CONFIG.DATE_RELOAD_MAX_BATCHES_PER_RUN || 3;
  const now = new Date(Number(job.nowMs) || Date.now());
  let cursor = Math.max(Number(job.cursor) || job.startRow, job.startRow);
  let batches = 0;

  while (cursor <= job.lastRow && batches < maxBatches) {
    const numRows = Math.min(batchSize, job.lastRow - cursor + 1);
    updateDoneDates_(sh, cursor, numRows, cols.RQ_STATUS, cols.RQ_DATE, "dd/MM/yyyy", now);
    updateDoneDates_(sh, cursor, numRows, cols.CHECK_STATUS, cols.CHECK_DATE, "dd/MM/yyyy HH:mm", now);
    cursor += numRows;
    batches++;
    job.processedRows = (Number(job.processedRows) || 0) + numRows;
    job.cursor = cursor;
    saveDateReloadJob_(job);
  }

  if (cursor <= job.lastRow) {
    scheduleDateReloadContinuation_();
    showSeoToast_("Đã reload tới dòng " + (cursor - 1) + ". Đã nhớ tiến độ và sẽ tự chạy tiếp.", "Reload Request TECH + Final Check", 5);
    return;
  }
  finishDateReloadJob_(job);
}

function finishDateReloadJob_(job) {
  PropertiesService.getDocumentProperties().deleteProperty(CONFIG.DATE_RELOAD_JOB_KEY);
  deleteDateReloadContinuationTriggers_();
  showSeoToast_("Hoàn tất reload Request TECH + Final Check tới dòng " + job.lastRow + ".", "Reload Request TECH + Final Check", 6);
}

function saveDateReloadJob_(job) {
  PropertiesService.getDocumentProperties().setProperty(CONFIG.DATE_RELOAD_JOB_KEY, JSON.stringify(job));
}

function scheduleDateReloadContinuation_() {
  const handler = CONFIG.DATE_RELOAD_CONTINUE_HANDLER;
  const exists = ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === handler);
  if (exists) return;
  ScriptApp.newTrigger(handler).timeBased().after(CONFIG.DATE_RELOAD_CONTINUE_AFTER_MS || 60000).create();
}

function continueDateReload_() { deleteDateReloadContinuationTriggers_(); processDateReloadJob_(); }

function deleteDateReloadContinuationTriggers_() {
  const handler = CONFIG.DATE_RELOAD_CONTINUE_HANDLER;
  ScriptApp.getProjectTriggers().forEach(trigger => { if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger); });
}

function reloadSeoRules() {
  rememberSeoSpreadsheet_(SpreadsheetApp.getActiveSpreadsheet());

  clearSeoRulesCache_();



  /*

   * Giữ nguyên chức năng cũ:

   * Rule đổi => Smart Index bị invalid để full SEO được quét lại.

   */

  invalidateSeoSmartIndex_();



  /*

   * Compile thử ngay để phát hiện rule lỗi sớm.

   */

  getCompiledSeoRules_();



  /*

   * Không dùng getUi().alert() nữa.

   * Alert có thể giữ execution chờ và gây timeout.

   */

  showSeoToast_(

    "SEO rules đã reload. Smart Index đã reset.",

    "Reload SEO rules",

    5

  );



  /*

   * Tính năng mới:

   * tự lên lịch quét lại theo batch.

   */

  if (CONFIG.SEO_AUTO_RESUME) {

    scheduleSeoContinuation_();

  }

}





// ======================================================

// HEADER ENGINE

// ======================================================



function rememberSeoSpreadsheet_(ss) {
  if (!ss || typeof ss.getId !== "function") return;

  try {
    PropertiesService
      .getDocumentProperties()
      .setProperty(
        CONFIG.SEO_SPREADSHEET_ID_KEY,
        ss.getId()
      );
  } catch (error) {
    console.log(
      "Cannot remember SEO spreadsheet id: " + error
    );
  }
}

function getSeoSpreadsheet_() {
  let ss = null;

  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (error) {
    ss = null;
  }

  if (ss) {
    rememberSeoSpreadsheet_(ss);
    return ss;
  }

  const spreadsheetId =
    PropertiesService
      .getDocumentProperties()
      .getProperty(
        CONFIG.SEO_SPREADSHEET_ID_KEY
      );

  if (!spreadsheetId) {
    throw new Error(
      "Không có SEO spreadsheetId đã lưu cho time-driven trigger."
    );
  }

  return SpreadsheetApp.openById(spreadsheetId);
}

function getInputSheet_() {
  const ss = getSeoSpreadsheet_();
  return ss.getSheetByName(CONFIG.INPUT_SHEET);
}





function getInputColumns_(sh) {

  const headerMap =

    getHeaderMap_(

      sh,

      CONFIG.HEADER_ROW

    );



  const cols = {



    UPLOAD_DATE:

      requireHeaderColumn_(

        headerMap,

        CONFIG.HEADERS.UPLOAD_DATE

      ),



    RAW_NAME:

      requireHeaderColumn_(

        headerMap,

        CONFIG.HEADERS.RAW_NAME

      ),



    SEO_NAME:

      requireHeaderColumn_(

        headerMap,

        CONFIG.HEADERS.SEO_NAME

      ),



    RQ_STATUS:

      requireHeaderColumn_(

        headerMap,

        CONFIG.HEADERS.RQ_STATUS

      ),



    RQ_DATE:

      requireHeaderColumn_(

        headerMap,

        CONFIG.HEADERS.RQ_DATE

      ),



    CHECK_STATUS:

      requireHeaderColumn_(

        headerMap,

        CONFIG.HEADERS.CHECK_STATUS

      ),



    CHECK_DATE:

      requireHeaderColumn_(

        headerMap,

        CONFIG.HEADERS.CHECK_DATE

      )

  };



  validateDistinctColumns_(

    cols

  );



  return cols;

}





function getHeaderMap_(

  sh,

  headerRow

) {

  const lastColumn =

    sh.getLastColumn();



  if (lastColumn < 1) {

    throw new Error(

      'Sheet "' +

      sh.getName() +

      '" không có cột nào.'

    );

  }



  /*

   * Cache header map để các thao tác RQ/Checked/SEO

   * không đọc lại hàng header liên tục.

   * Cache key có sheetId + lastColumn để tránh nhầm sheet.

   */

  const cache =

    CacheService

      .getDocumentCache();



  const cacheKey =

    CONFIG.HEADER_CACHE_KEY +

    "_" +

    sh.getSheetId() +

    "_" +

    headerRow +

    "_" +

    lastColumn;



  try {

    const cached =

      cache.get(

        cacheKey

      );



    if (cached) {

      const parsed =

        JSON.parse(

          cached

        );



      if (

        parsed &&

        typeof parsed === "object"

      ) {

        return parsed;

      }

    }

  } catch (error) {

    console.log(

      "Cannot read header cache: " +

      error

    );

  }



  const headers =

    sh.getRange(

      headerRow,

      1,

      1,

      lastColumn

    ).getDisplayValues()[0];



  const map = {};



  for (

    let i = 0;

    i < headers.length;

    i++

  ) {

    const normalized =

      normalizeHeader_(

        headers[i]

      );



    if (!normalized) {

      continue;

    }



    if (

      !Object.prototype

        .hasOwnProperty

        .call(

          map,

          normalized

        )

    ) {

      map[normalized] =

        i + 1;

    }

  }



  try {

    cache.put(

      cacheKey,

      JSON.stringify(map),

      CONFIG.HEADER_CACHE_SECONDS ||

        21600

    );

  } catch (error) {

    console.log(

      "Cannot save header cache: " +

      error

    );

  }



  return map;

}





function requireHeaderColumn_(

  headerMap,

  headerName

) {

  const normalized =

    normalizeHeader_(

      headerName

    );



  const column =

    headerMap[

      normalized

    ];



  if (!column) {

    throw new Error(

      'Không tìm thấy header "' +

      headerName +

      '" trong dòng ' +

      CONFIG.HEADER_ROW +

      ' của sheet "' +

      CONFIG.INPUT_SHEET +

      '".'

    );

  }



  return column;

}





function normalizeHeader_(value) {

  return String(value || "")

    .replace(/\s+/g, " ")

    .trim()

    .toLowerCase();

}





function validateDistinctColumns_(

  cols

) {

  const entries =

    Object.keys(cols)

      .map(

        key => [

          key,

          cols[key]

        ]

      );



  const seen = {};



  for (

    let i = 0;

    i < entries.length;

    i++

  ) {



    const key =

      entries[i][0];



    const column =

      entries[i][1];



    if (seen[column]) {

      throw new Error(

        'Header "' +

        key +

        '" và "' +

        seen[column] +

        '" đang trỏ vào cùng cột ' +

        column +

        ". Hãy kiểm tra lại tên header."

      );

    }



    seen[column] =

      key;

  }

}





// ======================================================

// FAST SEO ENGINE

// ======================================================



function getCompiledSeoRules_(ss) {
  const rawRules = getSeoRulesData_(ss);

  const exactMap = rawRules.exactRules || {};
  const prefixMap = rawRules.prefixRules || {};

  const exactKeys = Object.keys(exactMap)
    .sort(function(a, b) {
      return b.length - a.length;
    });

  const prefixKeys = Object.keys(prefixMap)
    .sort(function(a, b) {
      return b.length - a.length;
    });

  const singlePrefixKeys = prefixKeys.filter(
    function(key) {
      return normalizeSeoRuleKey_(key).length === 1;
    }
  );

  const normalPrefixKeys = prefixKeys.filter(
    function(key) {
      return normalizeSeoRuleKey_(key).length > 1;
    }
  );

  /*
   * Không dùng \b bọc cả KEY nữa.
   * \b fail với KEY kết thúc bằng ký tự đặc biệt như A+.
   * Boundary mới coi A-Z / 0-9 / _ là ký tự của một token.
   */
  const exactRegex = exactKeys.length
    ? new RegExp(
        "(^|[^A-Za-z0-9_])(" +
          exactKeys.map(escapeRegex_).join("|") +
          ")(?![A-Za-z0-9_])(?!['’]s)",
        "gi"
      )
    : null;

  const prefixRegex = normalPrefixKeys.length
    ? new RegExp(
        "(^|[^A-Za-z0-9_])(" +
          normalPrefixKeys.map(escapeRegex_).join("|") +
          ")(?:\\s*(\\d+))?(?![A-Za-z0-9_])",
        "gi"
      )
    : null;

  const singlePrefixRegex = singlePrefixKeys.length
    ? new RegExp(
        "(^|[^A-Za-z0-9_])(" +
          singlePrefixKeys.map(escapeRegex_).join("|") +
          ")\\s*(\\d+)(?![A-Za-z0-9_])",
        "gi"
      )
    : null;

  return {
    exactMap: exactMap,
    prefixMap: prefixMap,
    exactRegex: exactRegex,
    prefixRegex: prefixRegex,
    singlePrefixRegex: singlePrefixRegex
  };
}


function convertSeoNameFast_(text, rules) {
  if (
    text === null ||
    text === undefined ||
    text === ""
  ) {
    return "";
  }

  let result = normalizeSeoText_(text);

  // PREFIX >= 2 ký tự chạy trước EXACT.
  if (rules.prefixRegex) {
    result = result.replace(
      rules.prefixRegex,
      function(
        matchedText,
        leading,
        matchedKey,
        number
      ) {
        const key = String(matchedKey).toUpperCase();
        const fullName = rules.prefixMap[key];

        if (!fullName) {
          return matchedText;
        }

        const prefix = leading || "";

        if (
          number !== undefined &&
          number !== null &&
          String(number) !== ""
        ) {
          return prefix + fullName + " " + number;
        }

        return prefix + fullName;
      }
    );
  }

  // Prefix 1 ký tự: J4 / J 4 match; J Balvin không match.
  if (rules.singlePrefixRegex) {
    result = result.replace(
      rules.singlePrefixRegex,
      function(
        matchedText,
        leading,
        matchedKey,
        number
      ) {
        const key = String(matchedKey).toUpperCase();
        const fullName = rules.prefixMap[key];

        if (!fullName) {
          return matchedText;
        }

        return (
          (leading || "") +
          fullName +
          " " +
          number
        );
      }
    );
  }

  // EXACT chạy sau PREFIX.
  if (rules.exactRegex) {
    result = result.replace(
      rules.exactRegex,
      function(
        matchedText,
        leading,
        matchedKey
      ) {
        const key = String(matchedKey).toUpperCase();
        const replacement = rules.exactMap[key];

        if (!replacement) {
          return matchedText;
        }

        return (leading || "") + replacement;
      }
    );
  }

  return normalizeSeoText_(result);
}


function normalizeSeoText_(

  text

) {

  return String(text)

    .replace(

      /\s+/g,

      " "

    )

    .replace(

      /\b[xX]\b/g,

      " x "

    )

    .replace(

      /\s+/g,

      " "

    )

    .trim();

}





// ======================================================

// SEO RULE CACHE

// ======================================================



function getSeoRulesData_(ss) {

  const cache =

    CacheService

      .getDocumentCache();



  try {



    const cachedData =

      cache.get(

        CONFIG.SEO_CACHE_KEY

      );



    if (cachedData) {

      return JSON.parse(

        cachedData

      );

    }



  } catch (error) {



    console.log(

      "Cannot read SEO cache: " +

      error

    );

  }





  const rules =
    readSeoRulesFromSheet_(ss);



  try {



    const json =

      JSON.stringify(

        rules

      );



    cache.put(

      CONFIG.SEO_CACHE_KEY,

      json,

      CONFIG.SEO_CACHE_SECONDS

    );



  } catch (error) {



    console.log(

      "Cannot save SEO cache: " +

      error

    );

  }



  return rules;

}





function readSeoRulesFromSheet_(ss) {
  ss =
    ss ||
    getSeoSpreadsheet_();

  if (!ss) {
    throw new Error(
      "Không xác định được Spreadsheet khi đọc SEO NAME RULE."
    );
  }

  const ruleSheet =

    ss.getSheetByName(

      CONFIG.SEO_RULE_SHEET

    );



  const exactRules = {};

  const prefixRules = {};



  if (!ruleSheet) {

    return {

      exactRules,

      prefixRules

    };

  }



  const lastRow =

    ruleSheet.getLastRow();



  if (lastRow < 2) {

    return {

      exactRules,

      prefixRules

    };

  }



  const data =

    ruleSheet.getRange(

      2,

      1,

      lastRow - 1,

      3

    ).getDisplayValues();





  for (

    let i = 0;

    i < data.length;

    i++

  ) {



    const key =

      String(

        data[i][0] || ""

      ).trim();



    const fullName =

      String(

        data[i][1] || ""

      ).trim();



    const type =

      String(

        data[i][2] || ""

      )

        .trim()

        .toLowerCase();



    if (

      !key ||

      !fullName ||

      !type

    ) {

      continue;

    }



    const normalizedKey =

      key.toUpperCase();



    if (

      type === "exact"

    ) {



      exactRules[

        normalizedKey

      ] = fullName;



    } else if (

      type === "prefix"

    ) {



      prefixRules[

        normalizedKey

      ] = fullName;

    }

  }



  return {

    exactRules,

    prefixRules

  };

}





function clearSeoRulesCache_() {

  try {



    CacheService

      .getDocumentCache()

      .remove(

        CONFIG.SEO_CACHE_KEY

      );



  } catch (error) {



    console.log(

      "Cannot clear SEO cache: " +

      error

    );

  }

}





// ======================================================

// DATE UPDATE HELPERS

// ======================================================



function updateDoneDates_(

  sh,

  startRow,

  numRows,

  statusCol,

  dateCol,

  numberFormat,

  now

) {

  if (numRows < 1) {

    return;

  }



  const minCol =

    Math.min(

      statusCol,

      dateCol

    );



  const maxCol =

    Math.max(

      statusCol,

      dateCol

    );



  const width =

    maxCol -

    minCol +

    1;



  const values =

    sh.getRange(

      startRow,

      minCol,

      numRows,

      width

    ).getValues();



  const statusIndex =

    statusCol -

    minCol;



  const dateIndex =

    dateCol -

    minCol;



  const output =

    new Array(numRows);



  let hasChanges =

    false;





  for (

    let i = 0;

    i < numRows;

    i++

  ) {



    const hasDone =

      containsDoneWord_(

        values[i][statusIndex]

      );



    const oldDate =

      values[i][dateIndex];



    if (hasDone) {



      output[i] = [

        oldDate ||

        now

      ];



      if (!oldDate) {

        hasChanges = true;

      }



    } else {



      output[i] = [""];



      if (oldDate !== "") {

        hasChanges = true;

      }

    }

  }





  if (!hasChanges) {

    return;

  }





  const dateRange =

    sh.getRange(

      startRow,

      dateCol,

      numRows,

      1

    );



  dateRange.setValues(

    output

  );



  dateRange.setNumberFormat(

    numberFormat

  );

}





function fillDoneDatesByColumn_(

  sh,

  statusCol,

  dateCol,

  numberFormat

) {

  /*

   * GIỮ NGUYÊN chức năng Fill missing:

   * - status có DONE + date trống => điền NOW

   * - status không DONE + date có => xóa date

   *

   * Tối ưu:

   * - dùng getLastDataRowFast_ thay vì đọc cả status column

   *   chỉ để tìm last row

   * - batch nhỏ ổn định

   * - hoàn toàn độc lập SEO

   */



  const lastRow =

    getLastDataRowFast_(

      sh,

      statusCol

    );



  if (

    lastRow <=

      CONFIG.HEADER_ROW

  ) {

    return;

  }



  const batchSize =

    CONFIG.DATE_BATCH_SIZE ||

    1000;



  const now =

    new Date();



  for (

    let startRow =

      CONFIG.HEADER_ROW + 1;



    startRow <= lastRow;



    startRow += batchSize

  ) {

    const numRows =

      Math.min(

        batchSize,

        lastRow -

          startRow +

          1

      );



    updateDoneDates_(

      sh,

      startRow,

      numRows,

      statusCol,

      dateCol,

      numberFormat,

      now

    );

  }

}





// ======================================================

// LAST DATA ROW

// ======================================================



function getLastDataRowInColumn_(

  sh,

  column

) {

  const sheetLastRow =

    sh.getLastRow();



  if (

    sheetLastRow <=

    CONFIG.HEADER_ROW

  ) {

    return CONFIG.HEADER_ROW;

  }



  const startRow =

    CONFIG.HEADER_ROW + 1;



  const values =

    sh.getRange(

      startRow,

      column,

      sheetLastRow -

      CONFIG.HEADER_ROW,

      1

    ).getDisplayValues();





  for (

    let i =

      values.length - 1;

    i >= 0;

    i--

  ) {



    if (

      String(

        values[i][0] || ""

      ).trim() !== ""

    ) {

      return (

        i +

        startRow

      );

    }

  }



  return CONFIG.HEADER_ROW;

}









// ======================================================

// SEO AUTO RESUME ENGINE (MỚI)

// ======================================================



function scheduleSeoContinuation_() {

  if (!CONFIG.SEO_AUTO_RESUME) {

    return;

  }



  const handler =

    CONFIG.SEO_CONTINUE_HANDLER;



  const exists =

    ScriptApp

      .getProjectTriggers()

      .some(

        trigger =>

          trigger.getHandlerFunction() ===

          handler

      );



  if (exists) {

    return;

  }



  ScriptApp

    .newTrigger(handler)

    .timeBased()

    .after(

      CONFIG.SEO_CONTINUE_AFTER_MS

    )

    .create();



  console.log(

    "[SEO] Đã lên lịch resume."

  );

}





/*

 * Trigger handler.

 * Xóa trigger one-shot hiện tại trước,

 * rồi chạy tiếp Fill blanks.

 */

/*
 * ======================================================
 * FULL SEO SAFETY WATCHDOG
 * ======================================================
 */
function hasSeoWatchdogTrigger_() {
  const handler =
    CONFIG.SEO_WATCHDOG_HANDLER;

  if (!handler) return false;

  return ScriptApp
    .getProjectTriggers()
    .some(
      function(trigger) {
        return (
          trigger.getHandlerFunction() ===
          handler
        );
      }
    );
}


function scheduleSeoWatchdog_(delayMs) {
  if (!CONFIG.SEO_AUTO_RESUME) {
    return;
  }

  const handler =
    CONFIG.SEO_WATCHDOG_HANDLER;

  if (
    !handler ||
    hasSeoWatchdogTrigger_()
  ) {
    return;
  }

  ScriptApp
    .newTrigger(handler)
    .timeBased()
    .after(
      Math.max(
        1000,
        Number(delayMs) ||
        Number(CONFIG.SEO_WATCHDOG_AFTER_MS) ||
        90000
      )
    )
    .create();
}


function deleteSeoWatchdogTriggers_() {
  const handler =
    CONFIG.SEO_WATCHDOG_HANDLER;

  if (!handler) return;

  ScriptApp
    .getProjectTriggers()
    .forEach(
      function(trigger) {
        if (
          trigger.getHandlerFunction() ===
          handler
        ) {
          ScriptApp.deleteTrigger(
            trigger
          );
        }
      }
    );
}


function watchdogSeoWork_() {
  deleteSeoWatchdogTriggers_();

  if (
    isSeoExecutionReallyRunning_()
  ) {
    console.log(
      "[SEO SAFETY] Full SEO worker vẫn giữ lock. Rearm watchdog."
    );

    scheduleSeoWatchdog_(45000);

    return;
  }

  const scan =
    loadSeoScanState_() || {};

  scan.safetyResumeCount =
    Number(
      scan.safetyResumeCount || 0
    ) + 1;

  scan.lastSafetyResumeAt =
    Date.now();

  if (
    scan.status === "RUNNING"
  ) {
    scan.status =
      "QUEUED_RECOVERY";
  }

  scan.updatedAt =
    Date.now();

  saveSeoScanState_(
    scan
  );

  console.log(
    "[SEO SAFETY] Resume Full SEO từ checkpoint."
  );

  fillBlanksSeoDate();
}


function continueSeoWork_() {

  deleteSeoContinuationTriggers_();

  fillBlanksSeoDate();

}





/*

 * Helper nội bộ xóa trigger SEO resume.

 * Không đụng trigger Brand.

 */

function deleteSeoContinuationTriggers_() {

  const handler =

    CONFIG.SEO_CONTINUE_HANDLER;



  ScriptApp

    .getProjectTriggers()

    .forEach(

      trigger => {

        if (

          trigger.getHandlerFunction() ===

          handler

        ) {

          ScriptApp.deleteTrigger(

            trigger

          );

        }

      }

    );

}





/*

 * Public helper:

 * có thể Run tay nếu cần dọn trigger SEO.

 */

function clearSeoContinuationTriggers() {

  deleteSeoContinuationTriggers_();
  deleteSeoWatchdogTriggers_();



  console.log(

    "[SEO] Đã xóa continuation trigger."

  );

}





/*

 * Reset riêng SEO Smart Index.

 * KHÔNG đụng dữ liệu INPUT.

 * KHÔNG đụng Brand cache/state.

 */

function resetSeoSmartState() {
  const guard =
    LockService.getDocumentLock();

  if (
    !guard.tryLock(750)
  ) {
    console.log(
      "[SEO] Không reset state vì SEO execution đang chạy."
    );
    return;
  }

  try {
    clearSeoContinuationTriggers();
    deleteSelectedSeoContinuationTriggers_();
    deleteSelectedSeoWatchdogTriggers_();
    deleteSeoWatchdogTriggers_();

    const selected =
      loadSelectedSeoJob_();

    if (
      selected &&
      (
        selected.status ===
          "QUEUED" ||
        selected.status ===
          "WAITING" ||
        selected.status ===
          "RUNNING"
      )
    ) {
      selected.status =
        "CANCELLED_BY_SMART_RESET";

      selected.phase =
        "CANCELLED_BY_SMART_RESET";

      selected.updatedAt =
        Date.now();

      selected.heartbeatAt =
        selected.updatedAt;

      saveSelectedSeoJob_(
        selected
      );
    }

    clearSelectedSeoLease_();
    clearSeoRulesCache_();
    invalidateSeoSmartIndex_();
    clearPendingRanges_();

    console.log(
      "[SEO] Đã reset Smart Index / Pending / Rule cache / Selected state."
    );

  } finally {
    guard.releaseLock();
  }
}





/*

 * Force full rebuild SEO theo batch.

 *

 * Giữ Brand tách riêng:

 * hàm này KHÔNG gọi Brand.

 */

function forceRebuildAllSeoFullName() {

  clearSeoRulesCache_();

  invalidateSeoSmartIndex_();



  /*

   * Không clear pending vì edit đang chờ vẫn phải được giữ.

   */

  if (CONFIG.SEO_AUTO_RESUME) {

    scheduleSeoContinuation_();

  }



  fillBlanksSeoDate();

}





/*

 * Normalize key để phân loại prefix 1 ký tự.

 */

function normalizeSeoRuleKey_(

  value

) {

  return String(value || "")

    .trim()

    .toUpperCase();

}





// ======================================================

// HEADER CACHE HELPER (MỚI)

// ======================================================



function clearInputHeaderCache_(

  sh

) {

  try {

    sh =

      sh ||

      getInputSheet_();



    if (!sh) {

      return;

    }



    const lastColumn =

      sh.getLastColumn();



    const cacheKey =

      CONFIG.HEADER_CACHE_KEY +

      "_" +

      sh.getSheetId() +

      "_" +

      CONFIG.HEADER_ROW +

      "_" +

      lastColumn;



    CacheService

      .getDocumentCache()

      .remove(

        cacheKey

      );



  } catch (error) {

    console.log(

      "Cannot clear header cache: " +

      error

    );

  }

}





// ======================================================

// TIMEOUT SAFE HELPER

// ======================================================



function shouldStopSeoRun_(

  startedAt

) {

  return (

    Date.now() -

      startedAt >=

    CONFIG.SEO_SAFE_RUNTIME_MS

  );

}





// ======================================================

// GENERAL HELPERS

// ======================================================



function rangeTouchesColumn_(

  startCol,

  endCol,

  targetCol

) {

  return (

    startCol <=

      targetCol &&

    endCol >=

      targetCol

  );

}





function containsDoneWord_(

  value

) {

  return /\bDONE\b/i.test(

    String(value || "")

  );

}





function escapeRegex_(text) {
  return String(text)
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );
}





function showSeoToast_(

  message,

  title,

  seconds

) {

  try {



    SpreadsheetApp

      .getActiveSpreadsheet()

      .toast(

        message,

        title ||

          "INPUT Tools",

        seconds ||

          5

      );



  } catch (error) {



    console.log(

      "Toast error: " +

      error

    );

  }

}
