/**
 * PHÂN CÔNG TRỰC - Backend API (Cập nhật Hỗ trợ Đa phòng)
 * 
 * HƯỚNG DẪN CẬP NHẬT:
 * 1. Vào https://script.google.com mở dự án cũ
 * 2. Xóa code cũ, paste toàn bộ code mới này vào
 * 3. Nhấn "Triển khai" (Deploy) → "Quản lý công cụ triển khai" (Manage deployments)
 * 4. Bút chì (Sửa) → Phiên bản mới (New version) → Triển khai (Deploy)
 * 5. Vậy là xong! Vẫn dùng chung API_URL cũ nhưng đã hỗ trợ đa nhóm.
 */

const getStoreKey = (e) => {
  const room = (e.parameter.r || 'default').trim();
  return room === 'default' ? 'duty_roster_data' : 'duty_roster_data_' + room;
};

function doGet(e) {
  const key = getStoreKey(e);
  const data = PropertiesService.getScriptProperties().getProperty(key);
  
  // Create CORS headers manually to be safe
  const output = ContentService.createTextOutput(data || '{}')
        .setMimeType(ContentService.MimeType.JSON);
  return output;
}

function doPost(e) {
  try {
    const key = getStoreKey(e);
    const body = e.postData.contents;
    // Validate JSON
    JSON.parse(body);
    PropertiesService.getScriptProperties().setProperty(key, body);
    
    return ContentService
      .createTextOutput(JSON.stringify({ success: true, room: key }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

