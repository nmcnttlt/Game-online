# Ghi chú hợp nhất từ ZIP gốc

Phiên bản hợp nhất này chọn `TAOWEB_websocket/TAOWEB` làm nền tảng vì nó có giao diện phòng chờ, luồng Socket.IO và bộ máy trò chơi phía server.

Đã thực hiện:
- Gộp `GIAODIEN.html`, `KHAIBAO.html`, `LOGIC.html` thành `public/index.html` + `public/client.js` + `public/styles.css`.
- Chuyển công cụ vẽ mới nhất từ `drawing-tool-source/drawing-tool` vào `public/drawing/`.
- Giữ một bản duy nhất của `gartic-game.js`, `gartic-room.js`, `socket-server.js`, `words.js`.
- Dùng một package root duy nhất với Express + Socket.IO. Không giữ bản server `ws` trong `nodecode/` để tránh hai giao thức realtime song song.
- Không mang theo `node_modules/`, thư mục `.git` lồng, hoặc các bản sao cũ `LOGIC-GAME`, `TAOWEB_XONG`, `TAOWEB_websocket`.
- Thêm URL mời `/join/123456`, health endpoint `/health`, `.gitignore`, README và unit tests.

## Cập nhật sau hợp nhất

- Mã phòng nâng lên **6 chữ số**; giới hạn phòng **3–10 người**, thời gian vẽ **1–6 phút**.
- Thứ tự vẽ ngẫu nhiên, mỗi người đúng một lượt; đồng hạng khi bằng điểm.
- Đồng bộ nét vẽ trực tiếp trong lúc kéo chuột; thêm undo/redo và xoá canvas.
- Tách ô đoán từ khoá khỏi chat; đoán sai khoá ô đoán 10 giây.
- Gợi ý mỗi 20 giây, tối đa `floor(số chữ / 2)` chữ cái; che từ khoá trong chat bằng `*`.
- Thêm tố cáo + bình chọn 20 giây, giới hạn lượt tố cáo theo phòng, phạt 15%/25%/40%, lần thứ 4 bị loại.
- Giữ chỗ 30 giây khi mất kết nối, khôi phục phiên và trạng thái trận; chuyển host sau khi rời hẳn.
- Giao diện mới có theme sáng/tối, modal hướng dẫn, modal tố cáo/bình chọn và bố cục responsive.

## Cập nhật sửa lỗi (lượt 2)

- **Lỗi phiên ở màn hình tổng kết**: dọn `playerRoom` quá sớm ở pha `GAME_END` làm mất quyền khôi phục trong 30 giây và để lại "người chơi bóng ma" chiếm slot/khoá tên → đã bỏ khối dọn dẹp đó, giữ chỗ do `disconnects` xử lý.
- **Danh sách người chơi cũ khi trở về phòng chờ**: sự kiện `room_continued` giờ kèm danh sách sạch, xoá người đã rời khỏi giao diện.
- **Hai tab cùng tài khoản tranh phiên vô hạn**: khi một phiên được khôi phục, tab/socket cũ nhận `phien_da_thay_the`, tự rời về trang chủ và ngừng tự động resume lại.
- **Nét đang vẽ dở phải bị mất điểm dừng khi reconnect**: một nét đang kéo giữa chừng trong snapshot giờ được đăng ký lại (`activateRemoteStroke`) để các điểm tiếp theo không bị bỏ trôi.
- **Tên bị người mất kết nối khoá 30 giây**: người mới được nhận lại tên của người đang giữ chỗ; người cũ tự đổi nhãn (`Tên #2`) kèm thông báo, tên của người đang online vẫn khoá như luật.
- Bỏ dòng trạng thái xanh "đã đoán đúng, có thể chat bình thường…" và mọi dòng gợi ý chữ "Gợi ý m/n, vị trí x…" trong giao diện.

## Tăng tốc đồng bộ

- Chu kỳ tick engine: 250ms → **100ms** (hết giờ, mở lượt, kết thúc lượt, giải quyết bình chọn tức thời hơn).
- Đồng hồ phát cho client: 1000ms → **250ms** (đếm ngược mượt và tự hiệu chỉnh sớm hơn).
- Client render đếm ngược/ô đoán: 200ms → **100ms**; mạng chỉ dùng WebSocket (bỏ fallback polling).
- Lấy mẫu nét vẽ mịn hơn: ngưỡng điểm liều 0.75px → **0.4px**, nét truyền trực tiếp từng pointermove.

## Tăng tốc khôi phục tài khoản

- Server ping dự phòng 5 giây thay vì 25 giây → mất mạng được phát hiện trong ~5–10s (trước là ~25–30s), thời gian giữ chỗ 30 giây thực sự còn nguyên cho việc vào lại.
- Client thử kết nối lại dồn dập: 200ms đầu tiên, tối đa 1s giữa các lần thử → sau khi mạng trở lại, phiên được khôi phục gần như tức thời (bias không còn chờ 1–5 giây giữa các lần thử).

## Sửa lỗi khôi phục/tạo phòng (lượt 3)

- **Snapshot khôi phục sai nhãn**: `snapshotFor` trả người chơi theo nhãn engine (`name/score`) trong khi mọi sự kiện dùng nhãn view (`ten/diem`, `laChuPhong`...). Khôi phục phiên ở tab mới hiện tên `undefined` và mất thanh cài đặt host. Đã thêm `viewSnapshot` chuyển đổi tại `socket-server.js`.
- **Tab cũ bị thay phiên xoá mất phiên của tab mới**: `localStorage` dùng chung theo origin, nên `goHome()` ở tab cũ xoá token mà tab mới vừa khôi phục. Giờ tab bị thay phiên về trang chủ nhưng giữ nguyên phiên (`goHome({ keepSession: true })`).
- **Mã phòng hiện "------" sau khi tạo**: handler tạo/vào phòng chỉ render danh sách mà không gọi `updateRoom()`, nên mã phòng/thời gian/số người chỉ cập nhật khi có sự kiện đổi cài đặt. Giờ gọi `updateRoom(r.phong)` ngay khi nhận phản hồi.

## Bố cục công cụ vẽ

- Công cụ vẽ nằm **bên trái**, canvas **bên phải** (DOM sẵn thứ tự này). Trước đây breakpoint xếp dọc là 900px, nhưng iframe bảng vẽ trong trận chỉ rộng ~820px nên thanh công cụ bị đẩy lên trên canvas. Hạ breakpoint xuống **640px** (chỉ xếp dọc trên điện thoại rất hẹp) và thu sidebar về **220px** để canvas rộng hơn.

## Luật dấu tiếng Việt + hệ thống điểm mới (lượt 4)

- **Đoán đáp án phân biệt dấu**: thêm `normalizeGuess()` (chuẩn hoá NFC, bỏ hoa/thường, bỏ dấu câu và khoảng trắng thừa nhưng **giữ dấu**). Trước đây `normalize()` bỏ dấu nên "cai guong" vẫn đúng với "cái gương" — nay bị tính sai. `normalize()` cũ vẫn dùng cho việc so tên và che từ khoá trong chat (`maskAnswer`), để người chơi vẫn không lách luật che đáp án bằng cách gõ không dấu.
- **Điểm người đoán**: `P = 10 × (1 − t/T) × (1 − 0.2 × (r−1)/(G−1))`, làm tròn 2 chữ thập phân, kẹp 0–10.
- **Điểm người vẽ**: `D = (10/G) × Σ(1 − tᵢ/T)`, làm tròn 2 chữ thập phân, kẹp 0–10.
- `T` lấy theo **cả lượt** (thời gian vẽ + 60s đoán bonus) để đáp án đúng trong fase bonus vẫn có điểm; `G` (số người có quyền đoán) được **chốt ngay đầu lượt** vào `turn.totalGuessers`, `G ≤ 1` thì hệ số hạng bằng 1 để chia không bị 0.
- Điểm lưu dạng số thập phân; `addScore` làm tròn 2 chữ số để tổng không nhiễu do dấu phẩy động. Không ai đoán đúng → người vẽ 0 điểm.
- tutorial (`buildTutorial` + modal trong `public/index.html`) viết lại theo công thức mới và ghi rõ luật phân biệt dấu.

## Dời chữ khỏi giao diện (lượt 4)

- Ô đoán: bỏ vế "Đoán sai không bị trừ điểm", còn "Quan sát hình vẽ và nhập đáp án."
- Bảng vẽ: bỏ dòng "Ctrl+Z Hoàn tác" ở footer và bỏ toàn bộ `footer-right` ("Sẵn sàng vẽ", "Đang vẽ…", "Canvas đã được xóa", "N nét", "612 × 459"). `app.js` không còn tham chiếu các phần tử đó.
- Màn hình tổng kết: làm rỗng `resultNote` ("Đã hoàn thành tất cả lượt vẽ · N lượt đã chơi."), giữ phần tử để bố cục không đổi.

Không chỉnh sửa file gốc trong ZIP bạn gửi; đây là một thư mục kết quả riêng để bạn kiểm tra trước khi thay thế dự án cũ.
