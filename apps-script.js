/**
 * PHÂN CÔNG TRỰC - Backend API
 * 
 * HƯỚNG DẪN:
 * 1. Vào https://script.google.com → Tạo dự án mới
 * 2. Xóa code mặc định, paste toàn bộ code này vào
 * 3. Nhấn "Triển khai" → "Triển khai mới"
 * 4. Loại: "Ứng dụng web"
 * 5. Thực thi với tư cách: "Tôi" (Me)
 * 6. Ai có quyền truy cập: "Bất kỳ ai" (Anyone)
 * 7. Nhấn "Triển khai" → Copy URL
 * 8. Paste URL đó vào file app.js (biến API_URL)
 */

const STORE_KEY = 'duty_roster_data';

function doGet(e) {
  const data = PropertiesService.getScriptProperties().getProperty(STORE_KEY);
  return ContentService
    .createTextOutput(data || '{}')
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = e.postData.contents;
    // Validate JSON
    JSON.parse(body);
    PropertiesService.getScriptProperties().setProperty(STORE_KEY, body);
    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
