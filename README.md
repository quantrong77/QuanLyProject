# Web App quản lý tiến độ hiện trường (nhiều dự án)

Dự án đầu tiên: **NCS TBA 500kV Di Linh**, gồm các hạng mục chính *Thay MBA AT1*, *Thay MBA AT2*… Quản trị viên tạo thêm dự án và hạng mục chính, quản lý nhà thầu và đầu việc.

Cấu trúc dữ liệu:
```
Dự án                (VD: NCS TBA 500kV Di Linh)
 └─ Hạng mục chính   (VD: AT1 – Thay MBA AT1, AT2 – Thay MBA AT2)
     └─ Phần việc    (VD: I. Công tác lắp đặt MBA, II. Phần tháo dỡ…)
         └─ Đầu việc (từng công việc, theo pha A/B/C, gán nhà thầu)
```
 Các nhà thầu (Đội SCTNĐ3 – PTC3, NNB, PCC5, Toshiba…) cập nhật tiến độ hiện trường, kèm dashboard báo cáo và thống kê. Người dùng tự đăng ký và đăng nhập bằng tài khoản Google.

```
webapp/          Giao diện web (HTML/JS tĩnh, không cần build)
apps-script/     Backend API (Google Apps Script) – database là Google Sheet
tools/           Script chuyển file Excel tiến độ -> database
data/            DiLinh_DB.xlsx (database khởi tạo, sinh từ Excel)
```

## Kiến trúc

| Thành phần | Công nghệ |
|---|---|
| Database | Google Sheet trên Google Drive (sheet: Projects, Packages = hạng mục chính, Tasks, Updates, Users, Units = nhà thầu, Config). Dữ liệu được đọc theo tên cột, nên thêm cột không làm lệch dữ liệu |
| Ảnh hiện trường | Thư mục Drive `DiLinh_HienTruong_Anh` (riêng tư; chỉ người dùng đã đăng nhập xem qua API) |
| Backend | Google Apps Script Web App (kiểm tra Google ID token, phân quyền ở server) |
| Frontend | HTML/JS tĩnh: Chart.js, SheetJS, Google Identity Services |
| Đăng nhập | Sign in with Google: tự đăng ký, dùng được ngay |

## Chức năng

- **Dashboard**: % tiến độ gia quyền (so với kế hoạch đến hôm nay), đường cong S, tình trạng công việc, thẻ tiến độ từng **hạng mục chính** (bấm để lọc toàn bộ báo cáo theo hạng mục đó), tiến độ theo phần việc / nhà thầu / pha A-B-C, danh sách việc chậm, kế hoạch hôm nay và ngày mai, cập nhật mới nhất. Có bộ lọc và nút xuất Excel.
- **Cập nhật hiện trường** (tối ưu cho điện thoại): nhập % hoàn thành, trạng thái, ngày bắt đầu/hoàn thành thực tế, số ngày chậm, nội dung, ảnh chụp (tối đa 6, tự nén). Mỗi lần cập nhật được ghi vào nhật ký.
- **Tiến độ (Gantt)**: thanh kế hoạch và thanh thực tế, vạch hôm nay, phóng to/thu nhỏ.
- **Nhật ký & báo cáo ngày**: chọn ngày, hạng mục chính và nhà thầu, in báo cáo ngày, xuất Excel nhật ký.
- **Chọn dự án** ở thanh tiêu đề: mọi màn hình (dashboard, cập nhật, Gantt, nhật ký, xuất Excel) chỉ hiển thị dữ liệu của dự án đang mở.
- **Quản trị › Dự án** (admin): tạo, sửa, xóa dự án với mã, tên, chủ đầu tư, địa điểm, thời gian, trạng thái và nhà thầu tham gia. Xóa dự án còn đầu việc phải gõ lại mã dự án để xác nhận; nhật ký và ảnh vẫn được giữ.
- **Quản trị › Hạng mục chính** (admin, giám sát): thêm, sửa hạng mục chính của dự án đang mở (mã, tên, thời gian, trạng thái, thứ tự). Chỉ admin được xóa; xóa hạng mục còn đầu việc phải gõ lại mã để xác nhận. Nút *Đầu việc* mở thẳng danh sách đầu việc của hạng mục.
- **Quản trị › Nhà thầu** (admin): thêm, sửa, xóa nhà thầu với mã, tên, loại, người liên hệ, điện thoại, email. Không xóa được nhà thầu còn đầu việc hoặc người dùng.
- **Quản trị › Đầu việc** (admin, giám sát): thêm, sửa, xóa đầu việc của dự án đang mở; nhập hàng loạt từ Excel (tải *File mẫu*, kiểm tra lỗi từng dòng trước khi nhập); gán nhà thầu, **chuyển hạng mục chính** hoặc xóa hàng loạt. Danh sách nhà thầu chỉ gồm các nhà thầu tham gia dự án.
- **Quản trị › Người dùng** (admin): duyệt, phân vai trò và đơn vị, khóa tài khoản.

- **Trạng thái và thông báo**:
  - Màn hình khởi động có ký hiệu máy biến áp và 3 bước (kết nối → xác thực → tải dữ liệu); báo trước nếu máy chủ Google khởi động chậm.
  - Thanh tiến trình mảnh khi đang gọi máy chủ; nút đang xử lý hiện vòng xoay.
  - Thông báo theo loại (thành công / thông tin / lỗi) cho đăng nhập ("Đã đăng nhập: …", "Chào mừng trở lại"), đăng xuất (có hỏi xác nhận), hết phiên, đăng ký.
  - Báo mất mạng / có mạng trở lại.
  - Hộp xác nhận xóa riêng của app; xóa dữ liệu lớn phải gõ lại mã.
  - Tôn trọng chế độ giảm chuyển động của thiết bị.

### Vai trò

| Vai trò | Quyền |
|---|---|
| Quản trị (admin) – **PTC3, Tư vấn giám sát PECC4** | Toàn quyền: dự án, nhà thầu, đầu việc, duyệt tài khoản |
| Giám sát / BQLDA (manager) | Cập nhật mọi công việc; thêm, sửa, xóa và nhập đầu việc; gán nhà thầu |
| Đơn vị thi công (contractor) | Chỉ cập nhật công việc thuộc đơn vị mình |
| Chỉ xem (viewer) | Xem dashboard, tiến độ, nhật ký |

## Chạy thử ngay (chế độ DEMO, không cần Google)

```bash
cd webapp
python -m http.server 8765
```
Mở http://localhost:8765. Khi `config.js` để trống `API_URL`, app chạy chế độ DEMO: dữ liệu lấy từ Excel và lưu trên trình duyệt. Menu người dùng (góc phải) cho phép đổi vai trò/đơn vị để thử phân quyền.

## Triển khai thật (khoảng 20 phút)

### Bước 1 – Tạo database trên Google Drive
1. (Tùy chọn) Tạo lại database từ file Excel mới nhất:
   `python tools/excel_to_db.py "Di Linh Timeline Toshiba-PTC3_Thuc te_22.10.26.xlsx"`
2. Upload `data/DiLinh_DB.xlsx` lên thư mục Google Drive của dự án.
3. Mở file bằng Google Sheets, chọn **Tệp > Lưu dưới dạng Google Trang tính**. Từ đây trở đi, dùng file Google Sheet này làm database.

### Bước 2 – Gắn backend Apps Script
1. Trong Google Sheet: **Tiện ích mở rộng > Apps Script**.
2. Xóa nội dung mặc định, dán toàn bộ `apps-script/Code.gs`.
3. Vào **Cài đặt dự án**, tick "Hiển thị tệp kê khai appsscript.json", rồi dán nội dung `apps-script/appsscript.json`.
4. Chọn hàm `setup` và bấm **Chạy**, sau đó cấp quyền. Hàm này tạo thư mục ảnh và điền email của bạn vào `ADMIN_EMAILS` trong sheet Config.

### Bước 3 – Tạo Google OAuth Client ID (miễn phí)
1. Vào https://console.cloud.google.com, tạo project (hoặc dùng project có sẵn).
2. Mở **APIs & Services > OAuth consent screen**: chọn External, nhập tên app và email, rồi **Publish app**. App chỉ dùng scope email/profile nên không cần Google xét duyệt.
3. Mở **Credentials > Create credentials > OAuth client ID > Web application**.
   - *Authorized JavaScript origins*: thêm domain sẽ host web (ví dụ `https://ten.github.io`) và `http://localhost:8765` để chạy thử.
4. Copy **Client ID** và dán vào:
   - sheet **Config** > `GOOGLE_CLIENT_ID`
   - file `webapp/config.js` > `GOOGLE_CLIENT_ID`

### Bước 4 – Deploy API
1. Trong Apps Script: **Triển khai > Tùy chọn triển khai mới > Ứng dụng web**.
   - *Thực thi với tư cách*: **Tôi**
   - *Người có quyền truy cập*: **Bất kỳ ai**. API vẫn an toàn vì mọi yêu cầu đều phải kèm Google ID token hợp lệ và tài khoản đã được duyệt.
2. Copy URL `https://script.google.com/macros/s/.../exec` và dán vào `webapp/config.js` > `API_URL`.
3. Mỗi khi sửa `Code.gs`, vào **Quản lý triển khai > Chỉnh sửa > Phiên bản mới** để URL giữ nguyên.

### Bước 5 – Đưa web lên mạng (GitHub Pages)
Repo đã có sẵn workflow `.github/workflows/deploy-pages.yml`: mỗi lần push lên nhánh `main`, GitHub tự xuất bản 4 file trong `webapp/` (`index.html`, `app.js`, `styles.css`, `config.js`). File `.gitignore` chặn các file dữ liệu (Excel, `data/`, `webapp/demo-data.json`), nên dữ liệu dự án không lên GitHub.

1. Đưa code lên repo (PowerShell, trong thư mục dự án):
   ```powershell
   git init -b main
   git add .
   git status        # kiểm tra: KHÔNG có file .xlsx, data/, demo-data.json
   git commit -m "Web app tiến độ hiện trường"
   git remote add origin https://github.com/quantrong77/QuanLyProject.git
   git pull origin main --allow-unrelated-histories   # chỉ cần nếu repo đã có sẵn README/LICENSE
   git push -u origin main
   ```
2. Trên GitHub, mở repo, vào **Settings › Pages › Build and deployment › Source**, chọn **GitHub Actions**.
   GitHub Pages miễn phí chỉ áp dụng cho repo **Public**. Repo Private cần gói GitHub Pro; nếu không, dùng Cloudflare Pages hoặc Netlify kết nối repo private.
3. Vào tab **Actions** và chờ workflow *Deploy web app to GitHub Pages* chạy xong (khoảng 1 phút). Web có địa chỉ **https://quantrong77.github.io/QuanLyProject/**.
4. Google Cloud Console › Credentials › OAuth client đã tạo › **Authorized JavaScript origins**, thêm đúng dòng `https://quantrong77.github.io`: không có `/QuanLyProject`, không có dấu `/` ở cuối. Bấm Save và chờ 5 phút đến vài giờ để Google áp dụng.
5. Mở địa chỉ web và đăng nhập bằng tài khoản có trong `ADMIN_EMAILS`.

Cập nhật sau này: sửa file trong `webapp/`, rồi chạy `git add . && git commit -m "..." && git push`. Web tự cập nhật sau khoảng 1 phút.

### Bước 6 – Vận hành
1. Quản trị viên (email trong `ADMIN_EMAILS`) đăng nhập trước. Tài khoản này được kích hoạt tự động với quyền Quản trị.
2. Gửi link cho các đơn vị. Mỗi người đăng nhập Google, điền họ tên, số điện thoại và đơn vị:
   - Chọn **PTC3** hoặc **PECC4** (đơn vị quản trị, cấu hình `ADMIN_UNITS` trong sheet Config): nhận quyền **Quản trị** nhưng **phải được một quản trị viên hiện có duyệt**. Bước duyệt này chặn trường hợp người ngoài tự chọn PTC3 để lấy quyền.
   - Chọn đơn vị thi công khác: thành *Đơn vị thi công* và **dùng được ngay** (`AUTO_APPROVE = TRUE`).
   - Không chọn đơn vị: chỉ được xem.
3. Vào **Quản trị > Người dùng** để chỉnh vai trò/đơn vị hoặc **khóa** tài khoản không phù hợp. Nếu muốn bắt buộc duyệt trước khi dùng, đặt `AUTO_APPROVE = FALSE`.
4. Vào **Quản trị > Công việc**, lọc "(Chưa gán đơn vị)" và gán đơn vị cho các việc còn trống, gồm **phần I – Lắp đặt MBA** và **phần III – Vận chuyển MBA** (admin nhập tay).

## Sửa dữ liệu trực tiếp trên Google Sheet
App đọc dữ liệu thẳng từ Google Sheet, nên sửa trên Sheet thì app nhận được ngay ở lần đồng bộ kế tiếp:
- **Nút đồng bộ ⟳** ở thanh tiêu đề (có ghi giờ đồng bộ gần nhất) và nút *Đồng bộ* trên Dashboard: tải lại ngay.
- **Tự động đồng bộ mỗi 5 phút** khi app đang mở, và ngay khi quay lại tab app sau hơn 1 phút. Nếu có dữ liệu mới, app báo *"Dữ liệu vừa được cập nhật từ Google Sheet"*.
- Tự động đồng bộ **tạm hoãn** khi người dùng đang nhập liệu, đang mở hộp thoại hoặc đang chọn dòng, để không làm mất thao tác dở. Lượt sau sẽ đồng bộ.

Quy tắc khi sửa trên Sheet:
- **Không đổi tên dòng tiêu đề** (dòng 1) và không sửa cột `id`, `project_id`, `package_id`. Đó là các khóa liên kết.
- Ngày nhập dạng `2026-10-25`, `2026-10-25T07:30`, `25/10/2026` hoặc `25/10/2026 07:30` đều được; app tự chuẩn hóa.
- Thêm đầu việc trực tiếp: điền `project_id` (VD `P001`), `package_id` (VD `H001`), `name` và ngày kế hoạch; **để trống `id`**, app tự cấp id ở lần đồng bộ tiếp theo.
- `progress` là số 0–100; `unit` phải là mã nhà thầu có trong sheet Units.
- Nên dùng app cho cập nhật hằng ngày (có nhật ký, ảnh, phân quyền). Sửa trên Sheet hợp với việc chỉnh kế hoạch hàng loạt.

## Lưu ý dữ liệu nhập từ Excel
- Toàn bộ file tiến độ hiện có được nhập vào hạng mục chính **AT1 – Thay thế MBA AT1** của dự án NCS TBA 500kV Di Linh. Hạng mục **AT2 – Thay thế MBA AT2** đã được tạo sẵn (trạng thái *Chuẩn bị*, chưa có đầu việc).
- 141 công việc (mỗi pha A/B/C là một dòng) và 5 ghi chú hiện trường được nhập từ các ô ngày. Các ký hiệu Gantt dạng số (0.5) bị bỏ qua. Ghi chú lặp nhiều ngày như "Cắt điện 21/10 → 26/10" được đưa vào ghi chú của công việc.
- Đơn vị được lấy từ tên hạng mục có dạng `(NPTS3)`, `(NNB)`, `(PCC5)`. Các hạng mục `(NPTS3)` trong Excel gốc được chuyển thành **Đội SCTNĐ3** (Đội Sửa chữa, thí nghiệm điện 3 thuộc PTC3), kể cả trong tên công việc; hạng mục phun sương/PCCC được gán PCC5. **55 công việc chưa xác định được đơn vị**, chủ yếu ở phần I – Lắp đặt MBA, III – Vận chuyển MBA, II.E – Tủ DGA và VII – Nghiệm thu. Admin cần gán các việc này.
- Số ngày kế hoạch được tính từ ngày bắt đầu/kết thúc, vì cột "Thời gian" trong Excel bị định dạng giờ.
- % hoàn thành ban đầu: 100% nếu ghi chú có "hoàn thành", 10% nếu có "bắt đầu", còn lại 0%. Các đơn vị sẽ cập nhật tiếp trên app.
- Chạy lại `excel_to_db.py` sẽ tạo database mới từ đầu. Chỉ dùng khi khởi tạo; sau đó hãy chỉnh kế hoạch trực tiếp trong app.

## Thêm tiến độ cho hạng mục AT2 (ví dụ)
1. Chọn dự án *NCS TBA 500kV Di Linh*, vào **Quản trị › Hạng mục chính**, bấm *Sửa* ở AT2 để điền thời gian và đổi trạng thái sang *Đang thực hiện*.
2. Bấm *Đầu việc* ở dòng AT2, bấm *File mẫu*, điền các cột (Hạng mục chính, WBS, Phần việc, Đầu việc, Pha, Nhà thầu, Bắt đầu KH, Kết thúc KH…), rồi bấm *Nhập từ Excel*. Dòng nào để trống cột *Hạng mục chính* sẽ vào hạng mục chọn trong hộp thoại nhập.
3. Nhà thầu đăng nhập; trên dashboard bấm thẻ AT2 để xem riêng hạng mục này.

## Tạo dự án mới
1. Vào **Quản trị › Nhà thầu** và thêm nhà thầu mới (nếu chưa có).
2. Vào **Quản trị › Dự án**, bấm *Tạo dự án*, nhập thông tin và tick nhà thầu tham gia. Dự án mới được mở ngay.
3. Vào **Quản trị › Hạng mục chính** và thêm các hạng mục chính của dự án.
4. Vào **Quản trị › Đầu việc** và nhập đầu việc từ Excel, hoặc thêm từng đầu việc.

## Nâng cấp database đang dùng
Nếu đã triển khai bản trước (một dự án), chỉ cần dán `Code.gs` mới và **chạy lại `setup()`**. Hàm này tự thêm sheet Projects, Packages và các cột mới (`project_id`, `package_id`; loại, liên hệ của nhà thầu), tạo dự án mặc định và gắn các đầu việc cũ vào dự án đó. Sau đó tạo hạng mục chính trong app, rồi dùng *Chuyển hạng mục* ở tab Đầu việc để xếp các đầu việc cũ vào. Sau đó tạo phiên bản triển khai mới.

