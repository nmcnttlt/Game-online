# Vẽ & Đoán — Game vẽ hình đoán chữ nhiều người chơi theo thời gian thực

---

## 1. Tổng quan

Vẽ & Đoán là game xã hội nhiều người chơi (3–10 người/phòng) chơi trực tiếp trên trình duyệt. Mỗi lượt, **một người** nhận từ khoá bí mật và vẽ minh hoạ trên bảng vẽ chung; **những người còn lại** quan sát và nhập đáp án vào ô đoán riêng. Ai đoán đúng càng sớm thì càng nhiều điểm; người vẽ được điểm dựa trên việc cả phòng đoán đúng nhanh đến mức nào.

Toàn bộ trạng thái — phòng, lượt, đồng hồ, đáp án, quyền vẽ, điểm, bình chọn — **nằm ở server**. Client chỉ là giao diện và không bao giờ tự quyết định kết quả. Nhờ đó không thể gian lận bằng cách sửa giao diện.

| Thành phần | Mô tả |
| --- | --- |
| Thể loại | Vẽ hình + đố chữ theo lượt, thời gian thực |
| Số người / phòng | 3 – 10 |
| Độ dài một lượt | Thời gian vẽ (1–6 phút, host chọn) + 60 giây đoán bonus |
| Số lượt / trận | Đúng bằng số người chơi (mỗi người vẽ đúng 1 lần) |
| Thang điểm | 0 – 10 điểm mỗi lượt, dạng số thập phân |
| Kho từ khoá | 113 từ tiếng Việt có dấu, chia theo chủ đề (`src/words.js`) |

---

## 2. Cách chạy

### 2.1 Yêu cầu

- Node.js **18 trở lên** (`node --version` để kiểm tra)
- trình duyệt hiện đại có WebSocket (Chrome, Firefox, Edge, Safari)

Trên Arch/CachyOS:

```bash
sudo pacman -Syu nodejs npm
```

### 2.2 Khởi động

```bash
npm install
npm start
```

Mở `http://localhost:3000`. Dừng server bằng `Ctrl + C`.

Kiểm tra server sống:

```bash
curl -i http://localhost:3000/health    # mong đợi HTTP 200 + {"ok":true,...}
```

Chạy bộ kiểm thử logic:

```bash
npm test
```

### 2.3 Biến môi trường

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `PORT` | `3000` | cổng HTTP |
| `HOST` | `0.0.0.0` | địa chỉ bind |
| `PUBLIC_BASE_URL` | `http://localhost:PORT` | nền tảng cho link mời phòng |
| `CORS_ORIGIN` | tắt | cho phép origin chỉ định khi đặt sau reverse proxy |

### 2.4 Chơi thử trên một máy

1. `npm start`.
2. Mở `http://localhost:3000` ở **ba cửa sổ** (cửa sổ thường + cửa sổ ẩn danh).
3. Người 1 nhập tên → **Tạo phòng** (mã phòng 6 chữ số hiện ngay).
4. Người 2, 3 nhập tên + mã phòng → **Vào phòng**. Cũng có thể bấm link `/join/123456`.
5. Host chọn thời gian vẽ rồi bấm **Bắt đầu chơi**.
6. Muốn chơi từ điện thoại cùng LAN: `http://<IP-LAN-của-máy-server>:3000`.

---

## 3. Thể lệ chi tiết

### 3.1 Phòng và người chơi

- Mã phòng **6 chữ số**, sinh ngẫu nhiên, chỉ chứa chữ số.
- Cần tối thiểu **3** và tối đa **10** người để bắt đầu.
- Tên tối đa 15 ký tự, **không trùng với người đang kết nối**. Người đang mất kết nối (trong 30 giây giữ chỗ) có thể bị người khác nhận lại tên; người cũ tự đổi nhãn hiển thị thành `Tên #2` và vẫn chơi tiếp bình thường khi kết nối lại.
- Host là người tạo phòng. Nếu host rời phòng, quyền host chuyển ngẫu nhiên cho một người còn lại (chỉ sau khi việc rời đi được xác nhận, tức hết thời gian giữ chỗ).
- Host điều chỉnh được thời gian vẽ (**1–6 phút**, mỗi bước 1 phút) và số người tối đa (**3–10**) trong phòng chờ.

### 3.2 Diễn biến một trận

```
LOBBY ──start──► DRAWING ──hết giờ vẽ──► FINAL_GUESS ──hết giờ/ai cũng đúng──► TURN_END ──► (lượt kế)
                    ▲                                                                    │
                    └────────────────────────────────────────────────────────────────────┘
                                        ... khi mọi người đã vẽ ──► GAME_END
```

1. **Thứ tự vẽ** được xáo ngẫu nhiên khi bắt đầu; mỗi người vẽ **đúng một lượt**.
2. Mỗi lượt chọn một từ khoá **chưa từng dùng** trong trận.
3. Từ khoá chỉ được gửi cho người vẽ. Người đoán thấy dạng gợi ý `_ _ _`.
4. **DRAWING**: người vẽ thao tác trên bảng vẽ; ai cũng có thể đoán và chat.
5. **FINAL_GUESS**: canvas khoá lại, mọi người còn 60 giây đoán nốt.
6. **TURN_END**: lộ đáp án + bảng điểm lượt trong 5 giây, rồi sang lượt kế.
7. **GAME_END**: bảng xếp hạng chung cuộc; host có thể bấm chơi lại (phòng trở về phòng chờ).

### 3.3 Công cụ vẽ

Bút, tẩy, hút màu, chọn cỡ nét, hoàn tác (undo), làm lại (redo), xoá toàn bộ canvas. Bố cục: **thanh công cụ bên trái, bảng vẽ bên phải** (chỉ xếp chồng trên điện thoại rất hẹp, < 640px). Người không phải vai trò vẽ chỉ nhận bảng vẽ ở chế độ xem, không thao tác được.

Server kiểm tra quyền với mọi gói vẽ: người không phải người vẽ của lượt hiện tại bị từ chối outright.

### 3.4 Gợi ý

- Mỗi **20 giây** hệ thống lộ ngẫu nhiên **một chữ cái** (không tính khoảng trắng).
- Tổng số chữ được lộ tối đa `floor(tổng số chữ / 2)`.
- Gợi ý chỉ hiển thị dưới dạng ô chữ `_ _ _` trên bảng, không có dòng chữ mô tả.

### 3.5 Đoán đáp án — **có phân biệt dấu tiếng Việt**

Đây là quy tắc quan trọng nhất của cơ chế chấm điểm:

> Đáp án phải được gõ **đúng dấu**. Chỉ bỏ qua hoa/thường, dấu câu và khoảng trắng thừa.

Ví dụ với từ khoá `cái gương`:

| Nhập | Kết quả |
| --- | --- |
| `cái gương` | ✅ đúng |
| `CÁI  GƯƠNG` | ✅ đúng (không phân biệt hoa/thường và khoảng trắng) |
| `cai guong` | ❌ sai (thiếu dấu) |
| `cài gượng` | ❌ sai (sai dấu) |

Đoán sai: **0 điểm, không bị trừ điểm**, nhưng ô đoán bị khoá **10 giây**. Đoán đúng: ô đoán khoá lại với người đó, họ chuyển sang chat bình thường.

### 3.6 Chat và che từ khoá

- Chat phòng chờ và chat trong trận là **hai kênh tách biệt**; khi trận bắt đầu, chat trận đấu bắt đầu từ đầu.
- Tin nhắn chứa từ khoá bí mật được server **tự động che** bằng `*`: `từ khóa là con mèo` → `từ khóa là *******`.
- Việc so khớp để che là **không phân biệt dấu**, nên gõ `con meo` cũng bị che — tránh lách luật tiết lộ đáp án.
- Giới hạn 200 ký tự/tin nhắn, lưu 120 tin gần nhất mỗi kênh.

### 3.7 Tố cáo và bình chọn

- Giới hạn lượt tố cáo **chung cho cả phòng**: `L = max(2, floor(N/2))` với `N` là số người lúc bắt đầu trận. Mỗi người tố cáo tối đa 1 lần mỗi lượt vẽ.
- Lý do: tiết lộ đáp án, thông đồng, phá hoại trận đấu, gian lận tính điểm, hành vi không phù hợp.
- Bình chọn **20 giây**; cần **≥ 2 phiếu** và **≥ 2/3** số phiếu hợp lệ đồng ý. Người bị tố cáo không được bỏ phiếu.
- Tố cáo thành công: phạt **15% / 25% / 40%** điểm hiện có ở lần 1/2/3; **lần vi phạm thứ 4 bị loại khỏi phòng** và điểm về 0.

### 3.8 Mất kết nối và khôi phục phiên

- Ngắt mạng: server giữ chỗ **30 giây** kèm toàn bộ trạng thái (điểm, lượt, nét vẽ kể cả nét đang vẽ dở, chat, bình chọn).
- Client tự thử lại dồn dập (200ms đầu, tối đa 1s giữa các lần) và khôi phục phiên bằng token trong `localStorage`.
- Server phát hiện đứt kết nối trong ~5–10 giây (ping 5s), nên phần lớn 30 giây giữ chỗ dành cho người chơi.
- Cùng một token mở ở nơi khác: phiên cũ nhận thông báo `phien_da_thay_the`, tự về trang chủ **và không xoá phiên** đang chạy ở tab mới.
- Rời phòng *chủ động* giữa trận: tính **0 điểm ngay**, trận tiếp tục nếu còn ≥ 3 người.
- Người reconnect sau khi bị bỏ qua lượt sẽ được xếp thêm một lượt để bảo đảm mỗi người vẽ đúng một lần.

---

## 4. Hệ thống tính điểm

Hai công thức riêng, cùng thang **0 – 10 điểm/lượt**, lưu dạng **số thập phân** (làm tròn 2 chữ số).

### 4.1 Công thức điểm người đoán

$$
P = 10 \times \left(1 - \frac{t}{T}\right) \times \left(1 - 0.2 \times \frac{r-1}{G-1}\right)
$$

| Ký hiệu | Ý nghĩa |
| --- | --- |
| `P` | điểm người đoán nhận được |
| `T` | tổng thời gian lượt chơi = thời gian vẽ + 60s đoán bonus |
| `t` | thời gian đã trôi qua khi **server** nhận đáp án đúng |
| `r` | thứ hạng trả lời đúng (1 = đầu tiên) |
| `G` | tổng số người có quyền đoán, chốt ngay đầu lượt |

Trả lời càng sớm và thứ hạng càng cao thì điểm càng lớn. Nếu `G = 1` (chỉ một người đoán) thì hệ số thứ hạng bằng 1 để không chia cho 0.

### 4.2 Công thức điểm người vẽ

$$
D = \frac{10}{G} \sum_{i=1}^{C} \left(1 - \frac{t_i}{T}\right)
$$

| Ký hiệu | Ý nghĩa |
| --- | --- |
| `D` | điểm người vẽ nhận được |
| `G` | tổng số người có quyền đoán |
| `C` | số người đoán đúng |
| `T` | tổng thời gian lượt chơi |
| `t_i` | thời điểm người thứ `i` đoán đúng |

Càng nhiều người đoán đúng và đoán càng sớm thì người vẽ càng nhiều điểm.

### 4.3 Quy tắc chung

| Nội dung | Quy định |
| --- | --- |
| Điểm tối đa mỗi người | 10 điểm/lượt |
| Điểm tối thiểu | 0 điểm |
| Điểm lưu trữ | Số thập phân (2 chữ số) |
| Xác định thời gian | Timestamp do server ghi nhận |
| Trả lời sai | 0 điểm, không trừ điểm, khoá ô đoán 10s |
| Không ai đoán đúng | Người vẽ nhận 0 điểm |
| Người vẽ rời giữa lượt | Huỷ lượt, hoàn lại toàn bộ điểm đã cộng trong lượt đó |
| Đồng hạng | Cùng tổng điểm thì cùng hạng |

**Phân loại điểm mỗi lượt:** `0 – dưới 3.5` **Thấp** · `3.5 – dưới 7` **Trung bình** · `7 – 10` **Cao**.

### 4.4 Ví dụ minh hoạ

Lượt 3 người (1 vẽ + 2 đoán), thời gian vẽ 3 phút ⇒ `T = 180 + 60 = 240s`, `G = 2`.

| Sự kiện | Tính | Điểm |
| --- | --- | --- |
| Bob đoán đúng sau 30s (hạng 1) | `10 × (1 − 30/240) × (1 − 0.2 × 0/1)` | **8.75** |
| Cara đoán đúng sau 100s (hạng 2) | `10 × (1 − 100/240) × (1 − 0.2 × 1/1)` | **4.67** |
| Điểm người vẽ | `(10/2) × [(1 − 30/240) + (1 − 100/240)]` | **7.29** |

⇒ Bob **Cao**, Cara **Trung bình**, người vẽ **Cao**.

---

## 5. Kiến trúc kỹ thuật

### 5.1 Công nghệ

- **Node.js ≥ 18**, **Express 5** (static + health check), **Socket.IO 4** (realtime).
- Front-end thuần: HTML + CSS + JavaScript + Canvas API, **không framework, không build step**.
- Một hệ thống realtime duy nhất (Socket.IO, chỉ WebSocket, không dùng `ws` trực tiếp).

### 5.2 Sơ đồ luồng

```
Trình duyệt (client.js)  ◄──Socket.IO──►  socket-server.js  ◄──►  gartic-room.js
                                                                    │
                                       gartic-game.js (engine luật) ◄┘
                    _words.js (kho từ khoá) ────► engine
```

- `gartic-game.js` — engine thuần logic: pha, lượt, đoán, **tính điểm**, gợi ý, vẽ, tố cáo/bình chọn. Không biết gì về Socket.IO; nhận callback `emit`, `clock`, `rng` nên test được bằng đồng hồ ảo.
- `gartic-room.js` — phòng: tạo/ID 6 số, vào/rời, host, giữ chỗ 30s, nhận lại tên, sinh tutorial từ cấu hình thật.
- `socket-server.js` — ánh xạ sự kiện game ↔ socket, đổi snapshot engine (nhãn tiếng Anh) sang **view model** (`ten/diem/laChuPhong`) mà client đọc, định tuyến sự kiện riêng tư vào "phòng con" của từng người chơi.
- `public/client.js` — giao diện chính: trang chủ/phòng chờ/đấu trường/kết quả, đồng hồ, chat, đoán, snapshot restore, toast.
- `public/drawing/*` — bảng vẽ trong iframe, nhận/emit nét trực tiếp qua `postMessage` ↔ socket của trang cha.

### 5.3 Cấu trúc thư mục

```text
game-online/
├── server.js                 # HTTP + Socket.IO, ping 5s, graceful shutdown
├── package.json
├── public/
│   ├── index.html            # các màn hình + modal hướng dẫn / tố cáo / bình chọn
│   ├── styles.css            # theme sáng/tối, glass UI, responsive
│   ├── client.js             # logic giao diện, đồng hồ, chat, đoán, resume phiên
│   └── drawing/
│       ├── index.html        # bảng vẽ (iframe), công cụ bên trái
│       ├── app.js            # vẽ/tẩy/hút màu/undo/redo, đồng bộ nét trực tiếp
│       └── style.css
├── src/
│   ├── gartic-game.js        # engine: lượt, đoán, điểm, gợi ý, tố cáo
│   ├── gartic-room.js        # phòng, host, giữ chỗ, tutorial
│   ├── socket-server.js      # ánh xạ sự kiện ↔ Socket.IO, view model
│   └── words.js              # 113 từ khoá tiếng Việt
└── tests/
    ├── game.test.js          # 32 test: luật, điểm, phòng, reconnect, tố cáo
    └── socket.test.js        #  4 test: định tuyến sự kiện, snapshot view model
```

### 5.4 Hợp đồng mạng (tóm tắt)

| Hướng | Sự kiện | Nội dung |
| --- | --- | --- |
| C → S | `tao_phong`, `tham_gia_phong`, `khoi_phuc_phien`, `roi_phong`, `xin_ma_phong`, `xin_luat_choi` | phòng & phiên (có ack) |
| C → S | `cap_nhat_cai_dat`, `bat_dau_tran_dau`, `yeu_cau_choi_tiep` | cài đặt host, bắt đầu, chơi tiếp |
| C → S | `doan_tu_khoa` (ack), `tin_nhan_chat`, `tao_to_cao`, `bo_phieu_to_cao` | đoán, chat, tố cáo & bình chọn |
| C → S | `draw:stroke-start`, `draw:stroke-points`, `draw:stroke-end`, `draw:undo`, `draw:redo`, `draw:clear` | nét vẽ trực tiếp |
| S → C (cả phòng) | `phong_cap_nhat`, `cap_nhat_danh_sach_nguoi_choi`, `chuyen_luot_ve`, `bat_dau_tran`, `dong_ho`, `tin_nhan_tu_server`, `ket_thuc_luot`, `ket_thuc_game_dau`, `ve_phong_cho`, `goi_y_tu_khoa`, `chu_phong_moi`, `xoa_lich_su_chat`, `nguoi_choi_o_lai` | trạng thái phòng/trận |
| S → C (vẽ) | `draw:stroke-start`, `draw:stroke-points`, `draw:stroke-end`, `draw:undo`, `draw:redo`, `draw:clear` | repost nét, không gửi lại cho người vẽ |
| S → C (riêng tư) | `tu_khoa`, `doan_dung`, `doan_sai`, `doan_bi_chan`, `doan_cuoi`, `khoi_phuc_thanh_cong`, `phien_da_thay_the`, `to_cao_bat_dau`, `to_cao_cap_nhat`, `to_cao_ket_qua`, `to_cao_loi`, `bi_loai`, `loi_he_thong` | từ khoá, điểm, cooldown, phiên, bình chọn |

Mọi payload gửi xuống client dùng **nhãn tiếng Việt** của view model (`ten`, `diem`, `laChuPhong`, `idPhong`, `nguoiDangVe`…) cho cả sự kiện lẫn snapshot khôi phục phiên.

### 5.5 Đồng bộ và hiệu năng

| Kênh | Chu kỳ / ngưỡng |
| --- | --- |
| Tick engine | **100ms** (hết giờ, mở/kết thúc lượt, giải quyết bình chọn) |
| Đồng hồ phát về client | **250ms** |
| Render đếm ngược & ô đoán phía client | **100ms** |
| Nét vẽ | emit trực tiếp từng `pointermove`, ngưỡng lấy mẫu **0.4px** |
| Phát hiện đứt mạng | ping **5s** / timeout **5s** |
| Thử kết nối lại phía client | **200ms** đầu, tối đa **1s** |
| Vận tải | chỉ WebSocket |

Giới hạn chống lạm dụng: 1 packet ≤ 1MB, tối đa 3000 nét/lượt, 4000 điểm/nét, toạ độ bắt buộc trong 0–1, 200 ký tự/chat, 120 tin/chat lịch sử.

---

## 6. Giao diện

- Màn hình: **Trang chủ → Tạo phòng → Vào phòng → Phòng chờ → Đấu trường → Kết quả**.
- Theme sáng/tối, lưu lựa chọn trong `localStorage`.
- Đấu trường: bảng vẽ (iframe) + danh sách điểm trực tiếp + đồng hồ đếm ngược + chat 2 kênh (sảnh/trận) + ô đoán riêng + nút hướng dẫn/tố cáo.
- Bảng xếp hạng có huy hiệu top 3, cảnh báo "đang có người chơi mới", bảng điểm từng lượt.
- Toast cho điểm, đoán đúng/sai, kết nối lại, tố cáo.
- Responsive: ≥ 640px công cụ bên trái — canvas bên phải; hẹp hơn thì xếp chồng.

---

## 7. Kiểm thử

```bash
npm test          # node:test, 36 test, không cần mạng
node --check server.js && node --check public/client.js && node --check public/drawing/app.js
```

Các nhóm test đang có:

- **Tiện ích & luật**: chuẩn hoá tên (bỏ dấu), `normalizeGuess` (giữ dấu), che từ khoá, hợp lệ hoá nét vẽ.
- **Điểm**: công thức mới cho người đoán (thời gian + thứ hạng), công thức người vẽ, điểm trong fase bonus, không ai đoán đúng → 0, sai dấu → sai, cooldown 10s.
- **Phòng**: ID 6 số, 3–10 người, chặn tên trùng, nhận lại tên của người mất kết nối, transfer host, đóng phòng trống.
- **Reconnect**: giữ chỗ 30s (trong trận & phòng chờ), resume phiên, không "người bóng ma" ở màn hình tổng kết, người bị bỏ lượt được vẽ bù.
- **Socket**: định tuyến vào phòng riêng của người chơi, thông báo trước khi thay phiên, snapshot dịch sang view model.
- **Tutorial**: sinh từ cấu hình thật, phản ánh đúng giới hạn 3–10 người và 1–6 phút.

---

## 8. Giới hạn hiện tại

- Trạng thái phòng ở **RAM**: khởi động lại server xoá toàn bộ phòng đang mở.
- Chưa có tài khoản/xác thực, CSDL, lịch sử dài hạn, anti-cheat nâng cao.
- Token khôi phục nằm trong `localStorage` — không nên chia sẻ; ai có token có thể chiếm phiên.
- Phù hợp demo/phát triển trong phạm vi dự án học tập. Trước khi mở công khai cần thêm: rate limit, HTTPS + reverse proxy, cấu hình `CORS_ORIGIN`, giám sát, và giới hạn số phòng/kích thước payload theo hạ tầng.
- Đồng hồ máy khách chỉ để hiển thị; mọi quyết định thời gian lấy từ server.

---

## 9. Tài liệu liên quan

- `MIGRATION_NOTES.md` — nhật ký hợp nhất từ các bản gốc và các sửa đổi theo từng lượt (bao gồm lý do thay đổi công thức điểm và luật dấu tiếng Việt).
