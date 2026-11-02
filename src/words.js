'use strict';
// Kho từ khoá (hiển thị có dấu; khi so đáp án hệ thống tự bỏ dấu / hoa-thường).
// Dùng NFC để mỗi chữ cái là 1 ký tự, giúp lộ gợi ý từng chữ chính xác.
const WORDS = [
  // Động vật
  'con mèo', 'con chó', 'con gà', 'con cá', 'con voi', 'con rùa', 'con ếch', 'con bướm',
  'con thỏ', 'con ngựa', 'con hổ', 'con sư tử', 'con khỉ', 'con rắn', 'con chim', 'con vịt',
  'con ong', 'con kiến', 'con nhện', 'con cua', 'con tôm', 'con cá heo', 'con gấu', 'con hươu',
  // Phương tiện
  'ô tô', 'xe đạp', 'máy bay', 'tàu hỏa', 'con thuyền', 'xe buýt', 'xe máy', 'tên lửa',
  'khinh khí cầu', 'xe cứu hỏa', 'xe tải', 'tàu ngầm',
  // Thiên nhiên
  'ngôi nhà', 'mặt trời', 'mặt trăng', 'ngôi sao', 'cầu vồng', 'đám mây', 'cái cây', 'bông hoa',
  'núi lửa', 'dòng sông', 'bãi biển', 'cơn mưa', 'tia chớp', 'hồ nước', 'khu rừng', 'sa mạc',
  // Đồ ăn
  'quả táo', 'quả chuối', 'quả dưa hấu', 'cây kem', 'bánh mì', 'bánh sinh nhật', 'chiếc bánh',
  'quả cam', 'quả nho', 'quả dâu', 'cốc nước', 'bát phở', 'đĩa cơm', 'cái kẹo', 'ly trà sữa',
  // Đồ vật
  'điện thoại', 'máy tính', 'cái ghế', 'cái bàn', 'cái đèn', 'cái ô', 'đồng hồ', 'chiếc nón',
  'quyển sách', 'cây bút', 'cái kéo', 'chìa khóa', 'chiếc giày', 'cái cặp', 'cái gương', 'cái quạt',
  'bóng đèn', 'cái nồi', 'cái chảo', 'cái thìa', 'cái cốc', 'ba lô', 'kính mắt', 'điện thoại thông minh',
  // Địa điểm / khác
  'trường học', 'bệnh viện', 'siêu thị', 'sân bóng', 'công viên', 'thư viện', 'cây cầu', 'ngọn hải đăng',
  'cái cửa', 'cửa sổ', 'bậc thang', 'hộp quà', 'quả bóng', 'cái trống', 'cây đàn', 'bức tranh',
  'con diều', 'đồng hồ cát', 'cái la bàn', 'chiếc thuyền giấy', 'người tuyết', 'ông già noel',
].map(w => w.normalize('NFC'));

module.exports = { WORDS };
