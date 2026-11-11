# OEM Enterprise · Bàn làm việc dịch vụ doanh nghiệp mã nguồn mở + Mạng xã hội doanh nhân

<p align="center">
  <a href="README.md">简体中文</a> · <a href="README.en.md">English</a> · <strong>Tiếng Việt</strong> · <a href="README.ja.md">日本語</a> · <a href="README.ar.md">العربية</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.ru.md">Русский</a>
</p>

**Demo trực tuyến：<https://enterprise.aiworkin.com>**

Một dự án mã nguồn mở hợp nhất và chuyển đổi **bàn làm việc dịch vụ doanh nghiệp**（Hono + Prisma + MySQL + Next.js / Ant Design）với **mạng xã hội doanh nhân SNS**
（quan hệ / dòng trạng thái / nhóm / tin nhắn riêng / hồ sơ xin việc / chợ cung cầu / tuyển dụng）.

Đây không phải một công cụ đơn lẻ mà là một nền tảng hoàn chỉnh cho 「quản trị nội bộ + thu hút khách hàng bên ngoài + kết nối giao dịch」：trên nền tảng tài khoản và danh tính,
trước tiên là **trang chủ chính thức**（`/`，trang đích cho khách chưa đăng nhập, trên cùng chỉ có đăng nhập / đăng ký）để tiếp nhận khách truy cập, sau đó vào bảng điều khiển điều hành, 21 lối vào bàn làm việc（Tác vụ của tôi、Agent、Luồng công việc、Cơ sở tri thức、Workbuddy Enterprise Cloud、Bảng đa chiều、RPA、Sáng tạo nội dung、Công cụ marketing、
Tài sản số、Email AI、CRM、BI、OA、OKR、CS tiếp thị AI、Bàn làm việc HR、Quản lý dự án、Quản lý kho bán hàng、Trung tâm ứng dụng、Sảnh chủ đề）,
11 tuyến dịch vụ nghiệp vụ（Marketing / Cung ứng / Thuế kế toán / Vươn ra toàn cầu / Lao động linh hoạt / Logistics / IT / Sở hữu trí tuệ / Pháp lý / Think tank / Giao dịch tài sản）、mạng xã hội doanh nhân và tuyển dụng,
cùng một trang quản trị nền tảng được tổ chức theo 5 nhóm lớn với 26 mục（tổng quan dữ liệu nền tảng đã được hợp nhất vào bảng điều khiển `/dashboard`）。Toàn bộ tính năng mạng xã hội và cung cầu đều **khép kín cục bộ, không cần Key**；
khi cần công bố nhu cầu / dịch vụ lên thị trường thượng nguồn（AIworkin）, làm hồ sơ doanh nghiệp và xét duyệt tư cách, chỉ cần liên kết một APIKey AIPDD là thông suốt
——**hệ thống này không liên quan đến tiền mã hóa, không lưu giữ tài khoản thượng nguồn, toàn bộ phong cách và tương tác đều được viết lại cục bộ**.

> Đặc tả thiết kế và chuyển đổi xem tại [`docs/开源版整体设计方案.md`](docs/开源版整体设计方案.md).

| Đặc tả | Số lượng |
|---|---|
| Tuyến trang（Next.js App Router） | 75 |
| Thao tác HTTP（theo OpenAPI snapshot） | 1947 |
| Mô hình dữ liệu Prisma | 528 |
| Module nghiệp vụ backend | 91 |
| Ngôn ngữ giao diện | 8（bao gồm toàn trang RTL cho tiếng Ả Rập） |
| Cơ sở dữ liệu | MySQL 8 hoặc PostgreSQL（chọn một khi cài đặt） |

> Phiên bản hiện tại **v1.4.0**（[Ghi chú phát hành](https://github.com/liujh0729-jpg/AI-enterprise-OEM/releases/tag/v1.4.0)）：nâng cấp tài khoản và đăng nhập（mã xác minh email / điện thoại, quét mã WeChat, ghi nhớ đăng nhập 30 ngày）, tài liệu chia sẻ mở rộng đến nhân viên nhà cung cấp dịch vụ, đồng thời tích hợp các module Bàn làm việc cơ sở tri thức, Quảng trường mô hình, Bàn làm việc SEO, Thu hút khách AI, WeCom SCRM, Phần cứng thông minh.

---

## 📸 Xem trước giao diện

> Ảnh chụp dưới đây lấy từ trang demo <https://enterprise.aiworkin.com>（góc nhìn siêu quản trị viên, bên trái là menu「Bàn làm việc / Dịch vụ nghiệp vụ」）.

**Bàn làm việc Agent**：trò chuyện trực tiếp tạo ra hình ảnh / video；các thẻ bao gồm trò chuyện, tác vụ theo lịch, trợ lý, phân thân số, kỹ năng, chuyên gia và trình kết nối MCP（cổng ủy quyền「Thao tác được phép tự động thực thi」nằm dưới thẻ trình kết nối MCP）.
<img src="docs/screenshots/agent.png" width="900" alt="Bàn làm việc Agent">

**Công cụ marketing**：thu hút khách hàng, tiếp cận và dữ liệu trên một màn hình, mỗi thẻ có mô tả và lối vào riêng（Thu hút khách AI：radar khách tiềm năng → tiếp cận → hồ sơ khách hàng → kịch bản bán hàng → theo dõi → kiểm tra chất lượng và bảng điều khiển, thu thập và tiếp cận do plugin AIPDD Enterprise thực thi；WeCom SCRM：đồng bộ khách hàng gốc, gửi hàng loạt với xác nhận thủ công, SOP, thanh bên nhân viên, từ khóa nhạy cảm và kiểm tra chất lượng AI；kết nối KOL, gọi ra / gửi thư Alibaba Cloud, tối ưu GEO, tối ưu SEO, dẫn lưu mã động, Tencent Qidian, khai thác khách tiềm năng, dữ liệu lớn toàn cầu, phân phối nội dung đa nền tảng, thiết kế và khảo sát bảng hỏi, SalesBuddy）.
<img src="docs/screenshots/marketing-tools.png" width="900" alt="Công cụ marketing">

**Sáng tạo nội dung**：văn bản thành ảnh, ảnh thành video, nhân bản video, người kỹ thuật số, chỉnh sửa & xóa hình mờ, trích xuất nội dung chữ, chuyển văn bản thành giọng nói, âm nhạc, lồng tiếng, dựng ghép video, dịch ngược kịch bản và lời bình, cùng với gói ảnh「tối ưu trang sản phẩm」cho thương mại điện tử xuyên biên giới và trong nước；「Cộng đồng mẫu video」cho phép bạn duyệt mẫu theo mức sử dụng / mới nhất / được lưu nhiều nhất, và nhân bản mẫu với prompt và hình ảnh tham chiếu bằng mô hình của chính bạn——việc nhân bản là tác vụ bất đồng bộ được theo dõi trong thẻ「tác vụ tạo」trong trang（xem công thức trả phí sẽ tặng điểm cho người phát hành；quản trị viên nền tảng có thể tùy chọn đồng bộ mẫu từ nền tảng AIworkin）；cuối trang là công cụ tạo video có thể triển khai cục bộ.
<img src="docs/screenshots/content-creation.png" width="900" alt="Sáng tạo nội dung">

**Dịch vụ thuế kế toán**：tài liệu kê khai, kế hoạch khai báo, quản lý sổ kế toán, năng lực tự động hóa và thông tin nhu cầu；kế hoạch khai báo được tạo tự động từ loại người nộp thuế và tần suất khai báo của từng doanh nghiệp đã ký kết, với tiến độ theo từng loại thuế và xem chi tiết từng tờ khai.
<img src="docs/screenshots/tax-service.png" width="900" alt="Dịch vụ thuế kế toán">

**CS tiếp thị AI**：các cuộc trò chuyện, nhóm agent, cài đặt tiếp nhận, câu trả lời mẫu & kiến thức, trang web & truy cập, kết nối kênh và thống kê trên một màn hình；trạng thái tiếp nhận là Trực tuyến / Vắng mặt / Ngoại tuyến, và chỉ agent trực tuyến mới tham gia phân công tự động.
<img src="docs/screenshots/ai-service-desk.png" width="900" alt="CS tiếp thị AI">

---

## 🗺️ Bản đồ tính năng

| Nhóm | Module | Một câu mô tả | Thông tin xác thực thượng nguồn |
|---|---|---|---|
| Trang chủ | Trang chủ chính thức（`/`） | Trang đích tĩnh cho khách chưa đăng nhập：màn hình đầu, băng chuyền kịch bản, khối dịch vụ nghiệp vụ, tích hợp mở, các bước sử dụng và FAQ；trên cùng chỉ có「Đăng nhập / Đăng ký」, chân trang đọc tên, Logo, ICP và liên kết chân trang từ cài đặt trang；nội dung và hình ảnh được bảo trì trong phần quản trị「Cài đặt hệ thống → Cài đặt trang chủ」 | Không |
| Trang chủ | Bảng điều khiển điều hành（`/dashboard`） | Danh tính và tư cách, việc cần làm của tôi, sổ nghiệp vụ；đầu trang có lối tắt「Quản lý API Key / Nạp điểm」, khi chưa liên kết AIPDD Key có thêm lối vào liên kết màu đỏ；bảng điều khiển của quản trị viên nền tảng đồng thời hiển thị tổng quan dữ liệu nền tảng, việc cần duyệt và phân bố loại dịch vụ của nhà cung cấp | Không |
| Bàn làm việc | Agent | Trò chuyện trực tiếp tạo hình ảnh / video, kết quả được lưu vào tài sản số AIPDD của tài khoản này | AIPDD |
| Bàn làm việc | Cơ sở tri thức（`/kb`） | Tài liệu được đưa vào không gian tri thức và biên dịch thành trang wiki có thể truy xuất nguồn gốc, `[[liên kết]]` tạo ra đồ thị tri thức, tìm kiếm kết hợp và hỏi đáp có trích dẫn, trang ghi nhớ lưu trữ ký ức dài hạn và ký ức thao tác | Không |
| Bàn làm việc | Workbuddy Enterprise Cloud | Tác vụ theo lịch（AI làm rõ bản mô tả tác vụ）、Agent、tài khoản đám mây doanh nghiệp và tài khoản gọi AI được ủy thác | Tencent Cloud |
| Bàn làm việc | Bảng đa chiều | Tự tạo bảng dữ liệu có cấu trúc, 8 loại cột, tạo bảng bằng một câu, cột AI / hỏi dữ liệu / chế độ xem, kênh máy API Key, đồng bộ Feishu | Không |
| Bàn làm việc | Tự động hóa RPA | Tác vụ / tài khoản / script RPA trên đám mây, BitBrowser cục bộ nhận và thực thi rồi gửi kết quả về; tiện ích Chrome cục bộ nâng cấp thành **trình duyệt tác tử (browser agent)** — mô tả kết quả trong khung bên cạnh và Agent tự chủ thao tác nhiều bước trên các trang bạn đã đăng nhập, và bạn có thể tạo tác vụ theo lịch tự chạy mục tiêu theo tần suất đã đặt | AIPDD / tiện ích cục bộ |
| Bàn làm việc | Sáng tạo nội dung | Văn bản thành ảnh / video, người kỹ thuật số, lồng tiếng và nhạc, dựng ghép, xóa hình mờ và siêu phân giải, gói ảnh tối ưu trang sản phẩm, cộng đồng mẫu video, Drama Agent | AIPDD |
| Bàn làm việc | Công cụ marketing | Thu hút khách AI、WeCom SCRM、kết nối KOL、gọi ra / gửi thư Alibaba Cloud、tối ưu GEO、tối ưu SEO、dẫn lưu mã động、Qidian、khai thác khách tiềm năng、dữ liệu lớn toàn cầu、phân phối nội dung đa nền tảng、thiết kế và khảo sát bảng hỏi、thư viện kỹ năng marketing、SalesBuddy | Tự phục vụ từng bên / plugin cục bộ |
| Bàn làm việc | Quản lý tài sản số | Tệp lưu trên OSS của hệ thống：tìm kiếm, gắn thẻ, tải lên và xóa；「Tài liệu chia sẻ」chia sẻ theo tài khoản trong cùng tổ chức（doanh nghiệp đã xác thực hoặc nhà cung cấp dịch vụ）, tệp vẫn thuộc về người tải lên；tài sản AIPDD cũ có thể được chuyển hàng loạt trong phần quản trị | Không |
| Bàn làm việc | Dịch vụ email AI | Đọc nhiều hộp thư POP3 / IMAP, nội dung và tệp đính kèm không lưu vào cơ sở dữ liệu, soạn nháp hoặc tự động trả lời theo kịch bản | Mã ủy quyền email |
| Bàn làm việc | CRM | Khách tiềm năng, khách hàng, cơ hội, hợp đồng bán hàng, thu tiền, đơn hàng, phê duyệt và báo cáo | Không |
| Bàn làm việc | Phân tích thông minh BI | Bộ dữ liệu tuyển chọn tích hợp + nguồn dữ liệu chỉ đọc bên ngoài, hỏi dữ liệu thông minh, biểu đồ, bảng điều khiển | Không |
| Bàn làm việc | OA | Biểu mẫu nghỉ phép / hoàn ứng / thanh toán / mua hàng / đóng dấu và phê duyệt nhiều cấp, kết quả ghi ngược vào nghiệp vụ | Không |
| Bàn làm việc | Kế hoạch OKR | Chu kỳ, cây mục tiêu từ công ty đến cá nhân, báo cáo tuần/ngày, chấm điểm đánh giá | Không |
| Bàn làm việc | Bàn làm việc HR | Hồ sơ, nghỉ phép chấm công, tuyển dụng, lương và bảng điều khiển nhân lực（「nhân viên / đại lý」của tổ chức là cùng một tập người） | Không |
| Bàn làm việc | Quản lý dự án | Dự án / thành viên / cột mốc / vòng lặp, tác vụ và phụ thuộc, dòng thời gian công và phê duyệt bảng tuần, tỷ lệ chi phí và sổ cái, hợp tác bên ngoài và danh mục chủ thể, WBS AI và mức độ khỏe mạnh | Không |
| Bàn làm việc | Quản lý kho bán hàng | Sản phẩm và biến thể, tồn kho kho và dòng nhập xuất, nhập kho mua hàng, công nợ phải thu phải trả và hoàn ứng, thuế suất và chiến lược giá, thông tin kinh doanh AI | Không |
| Bàn làm việc | CS tiếp thị AI | Một tài khoản gắn nhiều trang web chính thức, tiếp nhận thủ công + ba chế độ trả lời AI | Không |
| Bàn làm việc | Trung tâm ứng dụng | Ứng dụng tích hợp + chợ ứng dụng, bốn thẻ tìm kiếm theo từ khóa | Không |
| Bàn làm việc | Sảnh chủ đề | Thảo luận chủ đề nội bộ doanh nghiệp / công khai, người khởi tạo có thể đóng và để AI tổng kết | Không |
| Dịch vụ nghiệp vụ | Marketing / Cung ứng / Thuế kế toán / Vươn ra toàn cầu / Lao động linh hoạt / Logistics / IT / Sở hữu trí tuệ / Pháp lý / Think tank / Giao dịch tài sản | Thư viện tài nguyên nhà cung cấp dịch vụ → chi tiết → ký kết；kênh tin nhắn nhu cầu và sổ nghiệp vụ | Một phần |
| Mạng xã hội doanh nhân | Mạng xã hội doanh nhân | Bạn bè / chặn, dòng trạng thái, nhóm kiểu Douban, tin nhắn riêng, hồ sơ nghề nghiệp | Không |
| Mạng xã hội doanh nhân | Tuyển dụng | Quảng trường tuyển dụng（đăng vị trí và liên hệ qua tin nhắn）+ nộp hồ sơ AI（hồ sơ, khớp, tối ưu, xác nhận ứng tuyển và phễu） | Cục bộ không / đồng bộ có |
| Mạng xã hội doanh nhân | Chợ cung cầu | Đăng nhu cầu / dịch vụ tổng quát, hai giai đoạn：cục bộ không cần Key + tùy chọn đồng bộ thượng nguồn | Cục bộ không / đồng bộ có |
| Dịch vụ mô hình | Quảng trường mô hình（`/model-plaza`） | Các mô hình khả dụng được nền tảng đưa lên thống nhất：đơn vị tính phí đồng nhất với thượng nguồn, có thể dùng thử trực tuyến và xem sổ lượng dùng, dùng Key `ek_` qua cổng tương thích OpenAI | Không |
| Dịch vụ mô hình | API Key / API-MCP-Skill / Cài đặt mô hình / Nền tảng tính toán AIPDD | Key ek_ gọi `/api/v1`, kết nối MCP, chọn mô hình, cuối cùng là liên kết ngoài trực tiếp đến nền tảng tính toán AIPDD | Một phần |
| Cài đặt quản lý | Danh tính và tư cách / Nhân viên·đại lý / Quản lý ký kết / Gói của tôi / Trung tâm điểm / Lời mời của tôi / Cơ chế nền tảng | Xác thực, đội nhóm, sổ ký kết, điểm hai loại tiền, quan hệ mời, cùng với Webhook, nhập xuất, quy tắc, chia sẻ, OIDC, đồng bộ Feishu / WeCom, lưu vết chấp nhận điều khoản, theo dõi sử dụng và chuyển đổi chủ thể | Một phần |
| Phần cứng thông minh | Quảng trường phần cứng / Thêm phần cứng / Phần cứng MCP / Phần cứng API | Danh mục mẫu và bộ phát triển（tải SDK / firmware, xác minh SHA-256）；kết nối thiết bị và trạng thái trực tuyến qua nhịp tim；công cụ MCP chuyên dụng theo mẫu（điều khiển Agent, `hw__mẫu__côngcụ`）và API（`/api/v1/hardware/**`）；SDK / mẫu / trình giả lập xem trong `hardware-devkit/` của kho mã | Không |
| Quản trị nền tảng | 26 mục / 5 nhóm（xem bên dưới） | Duyệt đăng ký, nhà cung cấp dịch vụ và tư cách danh mục, giám sát ký kết, bể tài khoản thuế kế toán, giám sát GEO / mã động, kiểm soát rủi ro điểm, gói dịch vụ chính thức, quảng trường mô hình, duyệt phát hành, quyền lợi hạn ngạch, theo dõi sử dụng, phần cứng thông minh, phiên bản điều khoản, nhật ký cập nhật, nâng cấp nền tảng, cài đặt hệ thống | — |
| Trợ giúp và tài liệu | Trung tâm trợ giúp `/help` | Cơ sở tri thức có phiên bản theo chương（Bắt đầu nhanh / Công cụ bàn làm việc / Nội dung và marketing / Phân phối đa nền tảng / Phần cứng thông minh / Nghiệp vụ và cài đặt quản lý）；trợ giúp thông thường được chia theo vai trò doanh nghiệp/cá nhân, nhà cung cấp dịch vụ, nhân viên nhà cung cấp dịch vụ nhưng đều có thể xem, khu vực quản trị nền tảng và triển khai vận hành Alibaba Cloud chỉ quản trị viên nền tảng xem được；cùng một nội dung tri thức cũng được mở qua công cụ chỉ đọc MCP, có thể hỏi trực tiếp Agent để nhận cách dùng chính thức | Không |

---

## 📖 Chi tiết tính năng

### 1. Tài khoản, danh tính và phiên

- **Vòng khép kín tài khoản cục bộ**：đăng ký（tên đăng nhập / email / kênh điện thoại tùy chọn）, đăng nhập, khôi phục, đổi mật khẩu, đổi liên kết, xóa tài khoản；nhật ký đăng nhập và cấm ở cấp nền tảng.
- **Cách đăng nhập và xác minh đăng ký**：trang đăng nhập kết xuất động theo công tắc quản trị「Đăng nhập thường（tài khoản + mật khẩu）/ Mã xác minh email / Mã xác minh điện thoại / Quét mã WeChat」；
  đăng ký kết xuất theo cách quản trị viên đã bật「Tên đăng nhập / Email / Số điện thoại」, đăng ký bằng email và SMS phải qua xác minh mã trước（email cần cấu hình SMTP, điện thoại cần cấu hình Alibaba Cloud SMS,
  cách chưa cấu hình kênh không thể chọn trong quản trị, giao diện không hiển thị）. Chọn「Tự động đăng nhập trong 30 ngày」sẽ kéo dài phiên đến 30 ngày.
- **Đăng nhập / đăng ký bằng quét mã WeChat**：quét mã qua「Ứng dụng website」của WeChat Open Platform；đã liên kết thì đăng nhập trực tiếp, chưa liên kết mà bật tự động đăng ký thì tạo tài khoản và liên kết（tên đăng nhập `wx_<8 ký tự cuối openid>`,
  lấy biệt danh và ảnh đại diện điền trước）, chưa bật tự động đăng ký thì hướng dẫn xác nhận danh tính bằng tài khoản mật khẩu hoặc mã email / điện thoại rồi liên kết；`state` của mã quét dùng một lần, có hiệu lực 5 phút,
  AppSecret được lưu mã hóa và quản trị chỉ trả về dạng che.
- **Quản trị「Cài đặt hệ thống → Tài khoản và đăng nhập」**：quản lý thống nhất cách đăng ký, cách đăng nhập, SMTP, Alibaba Cloud SMS và tham số WeChat；trước khi bật một kênh phải cấu hình đầy đủ thông tin xác thực tương ứng.
- **Chuẩn hóa chữ thường cho tên đăng nhập và email**：quy tắc sắp xếp MySQL không phân biệt chữ hoa chữ thường, PostgreSQL có phân biệt, nên thống nhất lưu và kiểm tra trùng ở dạng chữ thường, hai cơ sở dữ liệu hành vi giống nhau；cơ sở dữ liệu cũ có thể dùng
  `pnpm --filter aiworkin-enterprise-api db:normalize-usernames` để điền bù idempotent.
- **Phiên tự ký của hệ thống**：chỉ chấp nhận phiên SSO phát hành cục bộ（issuer `enterprise-sso`, khóa được dẫn xuất từ `JWT_SECRET` qua HKDF）,
  mỗi yêu cầu đối chiếu trạng thái tài khoản và `tokenVersion`——đổi mật khẩu, đổi liên kết, cấm đều bị thu hồi ngay；token của nền tảng thượng nguồn đều bị từ chối.
- **Đối chiếu lại khi sử dụng thành phẩm đã lưu**：chia sẻ công khai cũ, tải tệp xuất, token plugin Chrome, tác vụ theo lịch không người trực, kích hoạt theo lịch / sự kiện của luồng công việc, tư cách thành viên dự án tổ chức low-code, trước khi sử dụng đều đối chiếu lại theo bảng hiện tại「trạng thái tài khoản + quan hệ đang thuộc tổ chức」, nhân viên nghỉ việc hoặc thay đổi vai trò sẽ mất hiệu lực ngay（không đợi dọn dẹp bất đồng bộ thành viên dự án hoặc bộ nhớ đệm）；đối ngoại thống nhất trả về「không tồn tại / đã mất hiệu lực」, không tiết lộ lý do.
- **Nhiều danh tính và loại chủ thể**：quản trị viên nền tảng, người dùng doanh nghiệp, nhà cung cấp dịch vụ, nhân viên nhà cung cấp dịch vụ（đại lý）bốn loại danh tính；
  chủ thể chia làm doanh nghiệp, hộ kinh doanh cá thể, cá nhân ba loại. Sau khi chuyển danh tính thanh bên được tổ chức lại theo danh tính：quản trị viên nền tảng chỉ thấy quản trị nền tảng
  （chia làm năm nhóm Người dùng và nhà cung cấp dịch vụ / Giám sát vận hành nghiệp vụ / Tính phí và sản phẩm / Năng lực và bảo mật / Hệ thống và nội dung, tổng quan dữ liệu nền tảng trực tiếp hợp nhất vào bảng điều khiển điều hành `/dashboard`）,
  không bao gồm「Cài đặt quản lý」của góc nhìn tài khoản cá nhân.
- **Xác thực và tư cách**：thông tin doanh nghiệp có hiệu lực ngay khi gửi；hồ sơ nhà cung cấp dịch vụ cần nền tảng duyệt；nhân viên cần liên kết hoặc trực thuộc nhà cung cấp dịch vụ.
- **Mã mời**：mỗi tài khoản có một mã mời riêng, khi đăng ký điền tùy chọn là thiết lập quan hệ mời；「Lời mời của tôi」hiển thị mã mời, liên kết đăng ký, ai đã mời, số người đã mời；「Mời đăng ký」trong menu thả xuống ảnh đại diện đầu trang dẫn thẳng đến trang này.

### 2. Bảng điều khiển

- Lối tắt góc trên bên phải đầu trang：**Quản lý API Key**、**Nạp điểm**, sau đó là nút danh tính（quản trị viên là「Quản trị nền tảng」, các danh tính khác là「Danh tính và tư cách」）；khi chưa liên kết AIPDD API Key phía trái nhất có thêm một nút màu đỏ **Liên kết AIPDD API Key**, nhấp vào dẫn thẳng đến khối liên kết của「Quản lý API Key」, sau khi liên kết xong tự biến mất.
- Thẻ thống kê：**「Tác vụ của tôi」luôn đứng đầu**（lấy số việc chưa xử lý của trung tâm tác vụ, nhấp vào `/tasks`）、**「Hợp đồng hiệu lực」luôn đứng cuối**, các thẻ còn lại có trang đích riêng đều có thể nhấp trực tiếp；mỗi danh tính có một bộ thẻ riêng——doanh nghiệp（Tác vụ của tôi / Việc cần làm / OA chờ duyệt / Tin nhắn mới / Hợp đồng hiệu lực）、nhà cung cấp dịch vụ（Tác vụ của tôi / Doanh nghiệp được phục vụ / Việc cần làm / OA chờ duyệt / Hợp đồng hiệu lực）、nhân viên（Tác vụ của tôi / Cơ quan liên kết / Doanh nghiệp nhận việc / Việc cần làm / OA chờ duyệt）、quản trị viên nền tảng（Tác vụ của tôi / Việc cần làm / Tin nhắn mới）.
- Khối đầu tiên dưới thẻ thống kê là **Điều hướng nhanh**：mặc định cả thẻ điều hướng thường dùng có thể nhấp,「Cài đặt」góc phải có thể thêm / bớt và sắp xếp, lưu ở cấp tài khoản；tiếp theo lần lượt là **Bảng điều khiển tăng trưởng** của danh tính doanh nghiệp（tiến độ mục tiêu, thu tiền, dự án đang bàn giao, chuyển đổi thu hút khách, CS chuyển thành khách tiềm năng）、「Việc cần làm của tôi」（tổng hợp theo mục chưa hoàn thành, hạng mục dịch vụ chưa mở được ẩn theo danh tính）、**Top5 tác vụ của tôi**（từng dòng nhảy đến module nguồn để xử lý）、tổng quan việc chờ tôi xử lý và tin nhắn mới.
- **「Chờ tôi xử lý」chỉ lấy theo một cách duy nhất là `bySource` của trung tâm tác vụ**（cùng nguồn với `/tasks`）：chỉ liệt kê các hạng mục thuộc về chính mình và hiện có số việc（tư vấn trên trang chính thức, OA, CRM, OKR, dự án, luồng công việc, hợp đồng chờ xác nhận, duyệt nền tảng）；「Lời mời liên kết chờ tôi xác nhận」không thuộc nguồn tác vụ nào, bổ sung riêng một dòng.
- Quản trị viên nền tảng：bảng điều khiển chính là tổng quan dữ liệu nền tảng（đăng ký / doanh nghiệp / nhà cung cấp dịch vụ / hợp đồng / các loại chứng từ nghiệp vụ và số thuế）, việc cần duyệt（hồ sơ nhà cung cấp dịch vụ）và phân bố loại dịch vụ của nhà cung cấp；từ thanh bên vào thẳng các mục giám sát.

### 3. Bàn làm việc (21 lối vào)

| Module | Điểm năng lực chính |
|---|---|
| **Tác vụ của tôi** | Trung tâm tác vụ hợp nhất: gom tám loại việc chờ——phê duyệt OA, việc chờ OKR, tác vụ dự án, việc chờ CRM, phiên CS, xác nhận ký kết, duyệt nền tảng, nút nhân công của luồng công việc——về một màn hình (thu toàn bộ theo cấp tài khoản, lọc theo nguồn / nhóm + tìm kiếm + phân trang); mỗi dòng chỉ hiển thị mô tả tác vụ, trạng thái trung tâm và trạng thái nghiệp vụ, cùng lối vào「đi xử lý」, chi tiết vẫn xử lý tại module nguồn. Trạng thái trung tâm (chưa xử lý → đang xử lý → hoàn thành / hủy / quá hạn) tách riêng với trạng thái nghiệp vụ có thẩm quyền; người tạo có thể đóng / mở lại (cần xác nhận mật khẩu), trạng thái cuối của nghiệp vụ tại module nguồn tự động khép lại; bảng điều khiển điều hành còn có bảng Top5. |
| **Agent** | Trò chuyện với mô hình để trực tiếp sinh ảnh / video, kết quả tự động lưu vào tài sản số AIPDD của tài khoản này; bộ nhớ dài hạn / kho tài liệu / bộ nhớ thao tác đã hợp nhất vào trang「Cơ sở tri thức → Bộ nhớ」 (kho tài liệu và bộ nhớ dài hạn nay đặt thống nhất trong cơ sở tri thức, Agent toàn site chỉ giữ một chuẩn truy xuất duy nhất); cổng cấp phép「hành động được tự động thực thi」nằm dưới tab trình kết nối MCP, quản hai loại cấp phép——hành động ghi theo khế ước, và công cụ của trình kết nối MCP tự dựng (công cụ trình kết nối mặc định từ chối toàn bộ, mở theo từng trình kết nối; chưa cấp phép chỉ trả bản nháp, chạy không người trực một mực không thực thi). Kỹ năng / plugin khi tải lên đều qua kiểm duyệt an toàn AI trước (dùng Key và mô hình bạn cấu hình tại「Cài đặt mô hình」), qua mới vào kho; loại khai báo quyền cần xác nhận trước khi bật; khi chạy có lan can số lần gọi, gọi trùng và đầu ra dự phòng. Mô hình và Key cấu hình tại「Dịch vụ mô hình → Cài đặt mô hình」. |
| **Luồng công việc** | Điều phối nhiều bước trực quan: kéo thả nút và đường nối trên canvas; danh mục nút sinh từ sổ đăng ký năng lực hợp nhất (hành động theo khế ước, công cụ tích hợp / nghiệp vụ / trình kết nối / phần cứng / kỹ năng / plugin, cùng nút tích hợp kích hoạt / rẽ nhánh điều kiện / song song và hội tụ / AI / nhân công / Webhook), biểu mẫu tham số tự sinh theo khế ước; tạo mới có thể chọn 5 mẫu công thức tích hợp (theo dõi thu hút khách / gia hạn hợp đồng / đôn đốc thu tiền / kiểm định phiếu việc / kích hoạt nhập chức), điền sẵn tên và mô tả kèm sơ đồ luồng, người nhận mặc định là người khởi tạo, sao chép là chạy được; cũng có thể bấm「Tạo bằng AI」, mô tả nhu cầu bằng một câu hoặc vài lượt, mô hình văn bản sẽ viết lại canvas hiện tại từ các nút hiện có của hệ thống (qua cùng kiểm tra DAG trước khi nhận, nhu cầu không ánh xạ được sẽ chuyển sang nút「Agent AI」), nhấn「Áp dụng vào canvas」rồi lưu; lưu nháp → chạy thử từng bước trong Playground (đầu vào / đầu ra / thời gian / lỗi mỗi bước) → phát hành phiên bản đóng băng. Khi chạy có phát hiện chu trình DAG và phân giải biến mẫu (`{{input.x}}` / `{{vars.x}}` / `{{nodes.id.x}}` / `{{actor.userId}}`), nút nhân công tạm treo rồi được đánh thức khi đóng tại「Tác vụ của tôi」; luồng công việc đã chia sẻ vào danh mục công cụ Agent trong site và MCP với `wf__<id>`. Trước khi kích hoạt theo lịch / sự kiện miền / sự kiện tác vụ đều đối chiếu lại tư cách tài khoản và tổ chức của người khởi tạo theo bảng hiện tại, nghỉ việc hoặc bị loại khỏi tổ chức thì không tự khởi động luồng nữa. Danh sách nhóm theo「của tôi + một chủ thể một tab」 (`Công ty A · chia sẻ công ty` / `Nhà cung cấp C · chia sẻ nhà cung cấp`, tên chủ thể lấy từ cơ quan của bạn, tên dài cắt bớt + di chuột xem đầy đủ); dữ liệu luồng công việc mỗi chủ thể độc lập, tuyệt đối không trộn nhiều chủ thể chung một danh sách, khi tạo mới cũng chọn được chia sẻ đến công ty / nhà cung cấp nào. |
| **Cơ sở tri thức** | Đưa biên bản cuộc họp, bài viết, bản ghi cuộc gọi vào không gian tri thức, hệ thống biên dịch thành các trang wiki có thể truy nguyên: `[[liên kết]]` trong nội dung tự mọc thành đồ thị tri thức, truy xuất hỗn hợp (từ khóa + vector) và hỏi đáp kèm trích dẫn dùng ngay khi viết, khi chưa nối mô hình lớn thì toàn chuỗi chạy phương án quy tắc xác định; các tab gồm không gian tri thức, tài liệu, trang, hỏi đáp, đồ thị, người tiêu dùng và bộ nhớ. Vết xử lý của agent có thể chưng cất thành **bộ nhớ thao tác**, ngữ cảnh trước khi trả lời cũng chảy về từ đây; bộ nhớ dài hạn và kho tài liệu đặt thống nhất trong cơ sở tri thức, Agent toàn site chỉ giữ một chuẩn truy xuất này. |
| **Workbuddy Enterprise Cloud** | Tác vụ theo lịch: yêu cầu khẩu ngữ được AI làm rõ thành bản đặc tả tác vụ, tách mục và phân phát, đồng bộ tin nhắn Agent; Agent: tạo / phiên bản / phiên; tài khoản Workbuddy Enterprise: SecretId / SecretKey của chính người dùng lưu mật, có thể nhiều bộ song song; tài khoản gọi AI: mật khẩu / API Key / Cookie của nền tảng bên thứ ba lưu mã hóa, cấp phép bind theo tài khoảnEnterprise Cloud, lấy dùng qua kênh máy theo bind. |
| **Bảng đa chiều** | Bảng dữ liệu có cấu trúc tự dựng theo tài khoản: cột tùy chỉnh (tám loại), nhập dữ liệu từng dòng, đọc ghi qua kênh máy API Key; còn có lối vào đồng bộ với bảng đa chiều Feishu (Lark) và callback sự kiện Feishu. |
| **Tự động hóa RPA** | Tác vụ RPA (tạo tác vụ là bind script + tài khoản + tham số chạy), tài khoản RPA (mật khẩu lưu mật), script RPA (Automa JSON / JS / Python, có thể do mô hình văn bản AIPDD sinh theo yêu cầu); trình duyệt bit cục bộ nhận thực thi bằng API Key và gửi trả kết quả. **Trình duyệt tác tử (Chrome cục bộ)** — cùng một tiện ích AIPDD Enterprise đăng nhập bằng tài khoản của trang này rồi trở thành một thiết bị trực tuyến: LLM trên đám mây có thể quyết định từng bước và tiện ích thực thi ngay trong trình duyệt của bạn (báo về bản đồ trang và ảnh chụp, tạm dừng ở các thao tác nhạy cảm để bạn xác nhận thủ công, có thể dừng cứng bất cứ lúc nào, và không bao giờ nhận mật khẩu của nền tảng mục tiêu), hoặc nhấn Alt+A để mở **khung bên cạnh** của tiện ích, mô tả kết quả bằng một câu, và Agent tự lập kế hoạch rồi thao tác nhiều bước một cách tự chủ trên các trang bạn đã đăng nhập và trả về kết quả có cấu trúc; ba chế độ Act / Crawl / Extract, dùng mô hình từ chợ mô hình của hệ thống này và tính theo điểm nền tảng. Bạn có thể lưu **kỹ năng** (tri thức cá nhân / theo trang) và **ghi lại → công cụ** (phát lại trên cùng đường thực thi cục bộ như Agent, không ghi lại ô mật khẩu), và tiện ích có sẵn **MCP** mặc định: khi thiết bị xanh (trực tuyến), Agent nền tảng và các ứng dụng MCP bên ngoài đều có thể giao việc cho nó qua `/api/v1/mcp` bằng các công cụ `browser_*`. Cũng có thể gắn một chuỗi thao tác xác định (chrome_actions) để phát lại tuần tự không qua LLM, hoặc khởi tạo và lên lịch từ Agent / MCP và tab «tác vụ RPA dạng ma trận» trên một thiết bị trực tuyến. Khung bên cạnh cũng có thể tạo **tác vụ theo lịch** (một lần / tần suất định kỳ) để thiết bị trực tuyến này tự chạy một mục tiêu khi đến hạn; nếu thiết bị ngoại tuyến thì vòng đó bị bỏ qua (không chạy bù), còn tài khoản bị vô hiệu sẽ tự tạm dừng. |
| **Sáng tạo nội dung** | Thẻ công cụ một màn hình: văn sinh ảnh, văn/văn sinh video, nhân bản video, video người ảo, đổi người đổi sản phẩm trong video, sửa ảnh / xóa hình mờ, trích chữ từ âm thanh - video, tổng hợp giọng nói, sáng tác nhạc, lồng tiếng video, cắt ghép video ngắn, video suy ngược kịch bản, bản đọc / bài viết công chúng; hai thẻ tối ưu trang sản phẩm (**tối ưu trang sản phẩm xuyên biên giới**: bộ ảnh tiếng Anh cho Amazon / Etsy / site độc lập, ảnh chính và ảnh chi tiết dẫn dắt theo lý do mua; **tối ưu trang sản phẩm thương mại điện tử trong nước**: bộ ảnh chi tiết dài 750px cho Taobao / Tmall / JD / Pinduoduo / Douyin, nội dung giữ quy định luật quảng cáo về từ tuyệt đối), tạo bộ ảnh → mô hình lớn ra kế hoạch (lý do mua, khóa phong cách, prompt từng ảnh) → sinh ảnh lần lượt, có thể điền「mô tả nội dung từng ảnh」theo thứ tự ảnh chính 1..N / ảnh chi tiết 1..N để sinh tương ứng; cuối trang là「công cụ sáng tạo video」(AIPDD Drama Agent, hỗ trợ dán trực tiếp API Key của AIPDD / AIworkin). Siêu phân giải video và xóa hình mờ đi qua Volcano AI MediaKit, chỉ xuất hiện sau khi thêm kênh MediaKit và điền Key trong cài đặt mô hình; 「Cộng đồng mẫu video」sắp xếp theo lượng dùng / mới nhất / được lưu nhiều nhất kèm tìm theo từ khóa, đăng video mẫu + ảnh tham chiếu + prompt để lên kệ, xem công thức có thể đặt giá bằng điểm (bị xem là tặng điểm cho người đăng), 「dùng hiệu ứng」mang công thức vào trình sinh để nhân bản bằng mô hình của người dùng. Kết quả sinh tự động vào tài sản số. |
| **Công cụ marketing** | Lối vào chia bốn nhóm theo chuỗi nghiệp vụ: thu hút khách và chuyển đổi, nội dung và tăng trưởng tìm kiếm, dữ liệu và khai thác khách tiềm năng, tiếp cận và vận hành khách hàng, cả thẻ đều nhấp được. WeCom SCRM (SCRM gốc là nguồn đồng bộ khách hàng duy nhất: khách / thẻ / nhóm khách phản chiếu, mã sống và lời chào, tự gắn thẻ, gửi hàng loạt cho khách (xác nhận thủ công không thể tắt), kế thừa đang làm / nghỉ việc, SOP và thanh bên nhân viên H5, chặn từ nhạy cảm chiều ra / chiều vào chỉ cảnh báo, kiểm định AI bốn chiều; sau khi bật thì nhập khách Qidian tự tạm dừng để tránh ghi đôi), kết nối KOL (lọc theo ngành / nền tảng / số người theo dõi và xem thông tin liên hệ), gọi ra ngoài thông minh Alibaba Cloud (ánh xạ danh sách bảng đa chiều thành nhóm tác vụ gọi), đẩy thư Alibaba Cloud (đồng bộ liên hệ vào danh sách người nhận Alibaba Cloud), tối ưu công cụ GEO-AI (độ hiển thị thương hiệu trong trả lời AI, bể chủ đề, đề xuất nền tảng đăng bài), tối ưu SEO (khám sức khỏe site bằng crawler HTTP tự có miễn phí; nghiên cứu từ khóa và kho từ, theo dõi thứ hạng, thấu hiểu đối thủ, phân tích và xây dựng backlink, lưới SEO địa phương, trang hàng loạt theo chương trình, dữ liệu có cấu trúc và submit thu thập IndexNow / Baidu Zhanzhang (JSON-LD xuất được .json), báo cáo SEO và chia sẻ khử nhạy cảm (xuất được Markdown / HTML tự chứa), từ khóa「tầm tay」trong kho từ và GSC một chạm chuyển theo dõi thứ hạng / chuyển câu hỏi giám sát GEO, khách tiềm năng backlink một chạm đồng bộ vào danh sách người nhận đẩy thư Alibaba Cloud (chỉ đồng bộ không gửi hàng loạt), trang theo chương trình một chạm lưu thành tài sản nội dung; người dùng tự giữ tự trả khi có DataForSEO Key để mở khóa lượng tìm kiếm / thứ hạng / backlink thật, không có Key thì không làm giả chỉ dẫn cấu hình, phần diễn giải AI dùng mô hình hệ thống tính điểm; từ sổ theo dõi, liên kết tên miền riêng đã đăng thành công submit thu thập một chạm), dẫn lưu bằng mã sống (lối vào cố định + nhiều mã con chia ngẫu nhiên / tuần tự / theo trọng số, hạn mức, độ bám dính khách truy cập, thống kê kênh, link ngắn dùng tên miền riêng), Tencent Qidian (dữ liệu khách / vận hành WeCom / tiếp cận hội viên, khách có thể ghi vào CRM bản hệ thống), khai thác khách tiềm năng Google, năm công cụ dữ liệu lớn toàn cầu (dữ liệu doanh nghiệp / thương mại toàn cầu / nhân sự kinh doanh toàn cầu / KOL toàn cầu / POI toàn cầu), quản lý bán hàng AI SalesBuddy; **phân phối nội dung đa nền tảng**——một nội dung qua plugin trình duyệt AIPDD Enterprise đăng cùng lúc 13 kênh (ảnh - chữ động: Weibo / Xiaohongshu / Douyin / Kuaishou / Kênh video / Zhi Shi Xing Qiu; bài viết: Zhihu / Toutiao / Baijiahao / chuyên mục Bilibili / công chúng / Jianshu / Douban), nội dung viết bằng trình soạn thảo rich text, trước khi vào kho làm sạch theo danh sách trắng, rồi plugin theo năng lực từng kênh tự hạ cấp thành HTML có kiểu / Markdown / thuần văn bản; trạng thái nháp — chờ phân phối — đã gửi — thành công / thất bại và kết quả từng nền tảng đều xem được trong sổ bản hệ thống, hành động đăng hoàn tất cục bộ trên trình duyệt bạn đã đăng nhập, thông tin đăng nhập tài khoản nền tảng không ra khỏi máy; **thiết kế và khảo sát bảng hỏi**——thiết kế từng câu (chọn một / chọn nhiều / văn bản ngắn / văn bản dài / số / ngày / điểm), sau khi phát hành sinh link điền miễn đăng nhập và mã QR, mỗi phản hồi tự động ghi vào bảng đa chiều riêng của bảng hỏi (lọc được, xuất được, nối đồng bộ Feishu), hậu trường thống kê tỷ lệ lựa chọn và trung bình số theo từng câu, sau khi phát hành và có phản hồi thì câu hỏi khóa lại để giữ chuẩn dữ liệu lịch sử; **thư viện kỹ năng marketing**——bảy loại kỹ năng (nội dung / mạng xã hội / email / SEO / quảng cáo / khảo sát / bán hàng) và ngữ cảnh thương hiệu, điền tham số là chạy, thiếu Key mô hình thì ra kết quả quy tắc, kết quả đọng lại thành tài sản nội dung, và hỗ trợ kết nối / gọi năng lực kênh, đánh giá khi chạy và tác vụ theo lịch. |
| **Quản lý tài sản số** | Đồng bộ hoàn toàn với tài sản số AIPDD: tra theo tệp / ảnh / video / âm thanh, gắn thẻ, tải trực tiếp (tải lên là đăng ký lên nền tảng, không lưu bản cục bộ); thẻ tài sản cố định một hàng 4 cái, không giãn theo số lượng. Còn có tab「tài liệu chia sẻ」: chia sẻ tài sản của tài khoản này cho các tài khoản khác **trong cùng tổ chức**——doanh nghiệp đã xác thực chia theo thành viên doanh nghiệp, nhà cung cấp dịch vụ chia theo người phụ trách và nhân viên đang làm (đồng thời nhận hai loại bản ghi `org_staff` và `provider_staff`), khi chia sẻ chỉ lấy tài sản trong sổ của chính tài khoản này, người nhận phải nằm trong danh sách tổ chức, chọn được nhiều / chọn tất cả và thu hồi bất cứ lúc nào; chia sẻ chỉ đăng ký quan hệ sở hữu, tệp vẫn thuộc người tải lên. |
| **Dịch vụ email AI** | Thêm nhiều hộp thư (POP3 / IMAP) theo tài khoản đăng nhập, đọc hộp thư đến và thư nháp thời gian thực, **nội dung thư và tệp đính kèm một mực không lưu vào DB**; cấu hình kịch bản lời thoại, cách trả lời chọn「chỉ viết nháp」hoặc「viết nháp và tự trả lời」; tác vụ theo lịch của Agent dùng công cụ email soạn trả lời theo lời thoại; danh sách hiển thị hôm nay đã gửi / đã ra nháp và tổng lượng xử lý trong tháng. Còn có tab **mẫu email**: biến mẫu, xem trước sandbox, gửi thư thử đến hộp thư chỉ định. |
| **CRM** | Quản lý quan hệ khách hàng cấp tài khoản: khách tiềm năng, khách hàng, cơ hội, hợp đồng bán hàng, thu tiền, đơn hàng, phê duyệt và báo cáo, kèm bản ghi theo dõi và hỗ trợ AI; thành viên và quyền tái dùng「nhân viên và đại lý」của tài khoản này. Tab **theo dõi báo giá** chuyển báo giá bán hàng thành PDF theo mẫu (cổ điển / hiện đại / tối giản), link công khai kèm bản ghi xem và gửi. Sau khi phê duyệt đơn hàng qua, theo「cùng tổ chức + cùng đơn hàng」lũy đẳng tự tạo dự án, ngân sách lấy số tiền đơn, người phụ trách dự án đồng bộ, chi tiết đơn thấy「đã tự tạo dự án #id」; chuyển khách tiềm năng thành khách ghi về liên hệ SCRM WeCom, phiên dịch vụ khách AI chuyển một chạm thành khách tiềm năng CRM. Khách hàng 360 còn có tab「WeCom」: tra ngược liên hệ WeCom theo khách, nhân viên phụ trách, thẻ và tương tác cuối. |
| **BI phân tích thông minh** | BI cấp tài khoản: bộ dữ liệu CRM biên tập sẵn + nguồn dữ liệu chỉ đọc PostgreSQL / MySQL bên ngoài; hỗ trợ hỏi số thông minh, biểu đồ và bảng điều khiển. |
| **OA** | Đơn xin theo biểu mẫu và phê duyệt nhiều cấp theo tổ chức: nghỉ phép, hoàn ứng, thanh toán, mua sắm, dùng con dấu; thành viên lấy từ「nhân viên và đại lý」, có thể liên kết dữ liệu nghiệp vụ như CRM, kết quả phê duyệt ghi ngược, còn có nhắc theo lịch và việc chờ. Đơn mới hỗ trợ **AI soạn một câu**: mô tả sự việc là tự khớp mẫu và điền sẵn trường, kiểm tra rồi gửi. |
| **Kế hoạch OKR** | Theo tổ chức: chu kỳ năm / quý / tháng, cây mục tiêu từ công ty đến cá nhân, kế hoạch tuần / ngày, báo cáo ngày tuần và chấm điểm tổng kết chu kỳ. Tab **AI tách nhỏ** chạy「bản mục tiêu → làm rõ tương tác → ba phương án ứng viên → mô phỏng kiểm chứng → xác nhận thủ công ghi kho」: bản mục tiêu ghi mục tiêu nghiệp vụ tổng thể và tam giác sắt dự án (phạm vi / thời gian / ngân sách / nhân lực / vật lực / thiết bị / dịch vụ ngoài), trước khi tách có kiểm tra sơ bộ (chu kỳ, thành viên, bàn giao, chủ thể ngoài); AI mỗi vòng chỉ ra câu hỏi có cấu trúc và giả định, người phụ trách, nguồn chỉ số, số tiền, ngày đều kiểm chứng theo danh sách trắng tổ chức và đầu vào người dùng, thiếu mô hình thì dùng phương án quy tắc và ghi rõ「quy tắc」, sau xác nhận mới tạo mục tiêu, KR, tác vụ, liên kết tác vụ, OKR cá nhân và dự án; tác vụ mang tiêu chuẩn nghiệm thu, bậc chất lượng và trọng số khảo hạch, còn xem trước điểm khảo hạch tính theo KR / tác vụ. Mỗi mục tiêu mở drawer「chi tiết」: tiến độ, kết quả then chốt, tác vụ liên quan (trọng số / điền ngược giá trị mục tiêu / mục nghiệm thu) và bản ghi tiến độ (đánh dấu nguồn thủ công / tự động / kế hoạch / hệ thống và giá trị trước sau). |
| **Bàn nhân sự** | Năm tab cơ bản hồ sơ, chấm công, tuyển dụng, phỏng vấn, offer và đánh giá, còn có **quản lý lịch hẹn** (khung bận rỗi, link hẹn công khai, sổ hẹn), **hướng dẫn nhập chức** (mẫu theo vai trò → nhận offer tự khởi công → từng mục đánh dấu khép lại) và **chuyển giọng nói thành văn bản** (chuyển phỏng vấn / hội thoại, tóm tắt AI, ghi ngược điểm); thành viên và quyền tái dùng「nhân viên / đại lý」của tổ chức, phía tuyển dụng dùng chung một bộ vị trí với chợ tuyển dụng của mạng xã hội doanh nhân. |
| **Quản lý dự án** | Hồ sơ dự án, thành viên và cột mốc, vòng lặp và phụ thuộc tác vụ, sổ giờ công và phê duyệt bảng tuần; AI đưa đề xuất tách WBS và đánh giá sức khỏe dự án, kết quả tách chỉ ghi vào tác vụ một lần sau khi người xác nhận. Tab **chi phí** tự tính chi phí nhân công theo「giờ công đã duyệt × đơn giá còn hiệu lực」, đăng ký vật tư / thiết bị / dịch vụ ngoài từng dòng, mức chiếm ngân sách và giờ chưa có đơn giá hiển thị thời gian thực; tab **hợp tác ngoài** quản thống nhất danh mục nhà cung cấp / OPC / cá nhân / đối tác và đơn hợp tác (nháp → thực hiện → chờ nghiệm thu → quyết toán / hủy), nghiệm thu qua tự sinh khoản chi phí ngoài. Tác vụ hỗ trợ ba cách nhận: nhân viên nội bộ, nhận thầu tác vụ và đối tác ngoài, và giữ được tiêu chuẩn nghiệm thu, bậc chất lượng và trọng số khảo hạch. Tác vụ có thể **phát nhu cầu ra ngoài**: đăng phạm vi / bàn giao / ngân sách / thời gian / chuẩn nghiệm thu cho chủ thể ngoài, thu báo giá và thời gian cam kết rồi chấp nhận, hệ thống tự tạo đơn hợp tác ngoài, đổi người nhận tác vụ và đưa hợp tác đó vào nghiệm thu và chi phí. Tab **kiểm toán giờ công** lưu vết giá trị trước sau mỗi lần sửa và tổng hợp theo người, tab **đồng bộ tác vụ** hỗ trợ đồng bộ hai chiều với Jira / Teambition / TAPD. Dự án và tác vụ đều có drawer「cộng tác」: bình luận / trả lời / @ đồng nghiệp, thẻ, link tài nguyên và lưu; bình luận trước khi ghi làm sạch theo danh sách trắng, @ chỉ giới hạn thành viên đang thuộc tổ chức và vào thông báo trong site. Chi tiết dự án còn có hai tab tổng hợp「bàn giao」「chi phí」: bàn giao xem tác vụ hoàn thành / đang làm / quá hạn và trọng số nghiệm thu, chi phí xem ngân sách, chi phí đã phát sinh, tỷ lệ dùng ngân sách, hợp tác ngoài và giờ đã ghi (thao tác bảo trì vẫn ở tab「chi phí」trang dự án). |
| **Mua bán và tồn kho** | Sản phẩm / biến thể / danh mục / kho, sổ tồn kho và điều chuyển, phê duyệt lĩnh dùng, đơn mua và nhập kho, nhà cung cấp, phải thu phải trả và thu chi, hoàn ứng, thuế suất và chiến lược giá; AI đưa thấu hiểu kinh doanh theo bốn loại tồn kho / mua / phải thu / dòng tiền, khi chưa cấu hình Key mô hình thì ra theo quy tắc. |
| **Dịch vụ khách hàng AI** | CSKH cấp tài khoản: một tài khoản gắn được nhiều site website chính thức, khách truy cập từ cửa sổ CSKH của site (iframe cùng domain `/embed/service-desk`) vào, do nhân viên / đại lý tổ chức này tiếp đón thật; gồm tám tab phiên, **phiếu việc sau bán**, đội CSKH, cài đặt tiếp đón, câu thường dùng và tri thức, site và truy cập, truy cập kênh, thống kê. Phiếu việc sau bán chuyển theo máy trạng thái chờ xử lý → duyệt → qua / nhận hàng / gửi hàng → hoàn thành kèm dòng thời gian sự kiện. Trạng thái tiếp đón chia online / tạm rời / offline, chỉ online tham gia phân bổ tự động; AI theo cài đặt làm câu cố định, gợi ý trả lời hoặc tự trả lời, chế độ tự động có thể chuyển người bất cứ lúc nào, chế độ CSKH thuần AI không chuyển người. |
| **Trung tâm ứng dụng** | Lối vào gộp ứng dụng tích hợp và chợ ứng dụng: trang chủ tìm theo từ khóa「tôi dựng / doanh nghiệp này dựng / ứng dụng chợ ứng dụng」, còn có bốn tab doanh nghiệp tạo, tôi tạo, tôi tham gia, chợ ứng dụng. Thực thể ứng dụng tích hợp đặt trên bảng đa chiều, thành viên đọc ghi theo quyền vai trò; chợ ứng dụng là hiển thị chỉ đọc của danh mục công khai bên ngoài, site này không lưu ứng dụng, không lên kệ thay và không đánh giá thay. |
| **Sảnh chuyên đề** | Đăng thảo luận chuyên đề nội bộ doanh nghiệp hoặc công khai: nội bộ do nhân viên tổ chức này và đối tác ký kết / nhận thầu tham gia, công khai mở cho mọi tài khoản đăng nhập; người khởi xướng có thể kết án (AI tóm tắt toàn bộ phát biểu và trả lời), kết án lại, đóng hoặc xóa; phát biểu có thể ký tên bản thân hoặc phân thân số. |

### 4. Dịch vụ nghiệp vụ (11 dây dịch vụ + Chợ cung cầu)

Hình thái thống nhất: **thư viện tài nguyên nhà cung cấp dịch vụ** (duyệt danh sách → chi tiết → phát khởi ký kết) + **kênh tin nhu cầu / chợ dịch vụ** + **sổ nghiệp vụ**.
Nhà cung cấp dịch vụ phải hoàn tất đăng ký và qua tư cách danh mục tương ứng thì tài nguyên mới hiển thị ra ngoài; khi mộtbảng chỉ có một nhà cung cấp thì không hiển thị danh sách mà nhúng thẳng chi tiết của họ.
Chợ cung cầu là chợ công khai xuyênbảng, không có cổng đăng ký theobảng; cả hai danh sách nhu cầu / dịch vụ đều **phân trang** (không kéo vô hạn),
có thể lọc theo **khu vực (tỉnh / thành phố) và danh mục cấp hai**, cột danh mục (cấp một / cấp hai) hiển thị theo dòng; ngoài hai danh sách còn có tab **đánh giá** (phân bố điểm, sổ đánh giá), dữ liệu đánh giá đồng thời là nguồn điểm hiển thị của nhà cung cấp.

Danh sách **nhu cầu / dịch vụ** của các chợ dịch vụ và chợ cung cầu còn có một cặp lọc「**tất cả (nhu cầu / dịch vụ)** / **do tôi đăng**」:
「tất cả」đọc trực tiếp bể công khai của danh mục tương ứng trên AIworkin; 「do tôi đăng」đọc sổ bản hệ thống (hành động đăng ghi kho cục bộ trước,
rồi đồng bộ lên nền tảng và ghi nhớ lại ID nội dung nền tảng). Theo chuẩn người dùng 2026-11-09, 「do tôi đăng」**chỉ render với danh tính nhà cung cấp dịch vụ**,
danh tính doanh nghiệp một mực không xuất hiện bộ lọc này (chỉ có「tất cả」). Bản ghi đã chính thức đăng lên AIworkin không sửa xóa trong bản hệ thống,
chỉ để「xem」——các API ghi REST của nền tảng (PATCH / DELETE) với API Key một mực 401, MCP cũng không có công cụ sửa xóa.
**Chợ dịch vụ** (logistics / marketing / ra ngoài / lao động linh hoạt / IT / sở hữu trí tuệ / pháp lý / think tank / tài sản / cung tiêu / tài chính thuế) phím menu đều là「chợ dịch vụ ××」,
nội dung cùng một mục: tất cả dịch vụ = bể công khai nền tảng, dịch vụ tôi đăng = sổ cục bộ; mạng lưới cung tiêu / dịch vụ tài chính thuế 2026-11-09 do
「đăng dịch vụ」đổi tên và gộp vào (người dùng: 「thống nhất với các chợ khác, vừa thấy bể công cộng vừa thấy dịch vụ tôi đăng」).
**Tab chợ của mạng lưới cung tiêu phía doanh nghiệp cũng hiển thị** (2026-11-09): chợ toàn site dạo được, doanh nghiệp chỉ không đăng được dịch vụ——
lối vào「đăng dịch vụ」không render theo danh tính, bộ lọc「dịch vụ tôi đăng」cũng không xuất hiện, backend `assertPublishAllowed` chặn cùng chuẩn.

| Board | Nội dung |
|---|---|
| Dịch vụ marketing | Khám phá quán của KOL / livestream bán hàng · kênh tin nhu cầu |
| Mạng lưới cung tiêu | Cộng tác cung cầu B2B: trạm dịch vụ, đặt hàng hóa, đặt lịch dịch vụ ngoài tuyến (báo giá do nhà cung cấp dịch vụ hoặc nhân viên được chỉ định hoàn thành) và chợ dịch vụ mạng lưới cung tiêu |
| Dịch vụ tài chính thuế | Tài liệu báo thuế, kế hoạch khai báo, quản lý sổ sách, năng lực tự động hóa, thông tin nhu cầu và chợ dịch vụ tài chính thuế; kế hoạch khai báo tự sinh theo tính chất người nộp thuế của doanh nghiệp ký kết (thông thường / nhỏ lẻ) và tần suất khai báo (tháng / quý / năm); sau khi năng lực doanh nghiệp được mở có thể do Qi Xiang Yun tự khai báo, tự xuất hóa đơn và tra hóa đơn đã xuất |
| Xuyên biên giới | Nhà cung cấp dịch vụ xuyên biên giới và công cụ dịch vụ ra ngoài |
| Lao động linh hoạt | Thư viện tài nguyên, nhu cầu lao động (gồm hồ sơ vào việc) và trả lương lao động linh hoạt (bật tắt cấp nền tảng, mặc định bật) |
| Dịch vụ logistics | Vận tải đường bộ trong nước / đại lý vận chuyển xuyên biên giới · kênh tin nhu cầu |
| Dịch vụ IT | Triển khai AI / phát triển phần mềm / năng lực tính toán / phần cứng / dữ liệu · kênh tin nhu cầu |
| Sở hữu trí tuệ | Thư viện tổ chức / đại lý, tin nhu cầu và tư vấn bảo vệ quyền |
| Dịch vụ pháp lý | Thư viện luật sư / hãng luật và tin nhu cầu |
| Dịch vụ think tank | Thư viện tổ chức / chuyên gia và tin nhu cầu |
| Giao dịch tài sản | Cho thuê mua tài sản và dịch vụ môi giới · kênh tin nhu cầu |
| Chợ cung cầu | Chợ cung cầu công khai xuyên bảng: hai tab **nhu cầu / dịch vụ**, mỗi tab có hai bộ lọc「**tất cả (nhu cầu / dịch vụ)** (bể công khai nền tảng AIworkin, đọc qua kênh nền tảng, chưa bind Key vẫn duyệt được) / **dịch vụ do tôi đăng** (sổ bản hệ thống, chỉ render với danh tính nhà cung cấp dịch vụ)」; đăng ghi sổ bản hệ thống trước rồi đồng bộ nền tảng và ghi nhớ lại ID nội dung nền tảng, bản ghi đã đăng lên nền tảng chỉ cung cấp「xem」trong bản hệ thống (REST ghi và MCP của nền tảng đều không hỗ trợ sửa xóa); hai danh sách phân trang (không kéo vô hạn), lọc được theo khu vực và danh mục cấp hai; mọi tài khoản đăng nhập đều đăng được, nội dung đăng vào cổng duyệt tự động |

- **Ký kết**：doanh nghiệp phát khởi → nhà cung cấp dịch vụ xác nhận → vào sổ ký kết; quản trị viên nền tảng có thể giải trừ ký kết đang hiệu lực tại「giám sát ký kết」.
- **Gói dịch vụ chính thức**：cột nhà cung cấp dịch vụ của cácbảng nghiệp vụ hiển thị gói chính thức nền tảng (giá tham chiếu nhân dân tệ + giá điểm quy đổi theo tỷ giá hậu trường), doanh nghiệp mua trực tiếp bằng điểm; sau khi mua do nền tảng chủ trì doanh nghiệp ký kết từng mục với nhiều nhà cung cấp chất lượng, chuẩn gói là「gói này do nền tảng tích hợp nhà cung cấp chất lượng hoàn thành bàn giao」, ký kết một mực phải qua nhà cung cấp xác nhận mới hiệu lực (nhà cung cấp đặt sẵn cũng chỉ tự phát khởi, không tự xác nhận), tiến độ bàn giao đọc trạng thái ký kết thời gian thực. Hậu trường「gói dịch vụ」duy trì danh mục và hàng đợi bàn giao (khớp, chủ trì phát khởi, đổi chủ thể, hoàn tiền một phần / toàn đơn), giới hạn mua đếm theo doanh nghiệp, gói không tham gia quản lý chu kỳ bàn giao và hết hạn; phía người dùng「gói của tôi」xem gói đã mua và tiến độ bàn giao từng mục.
- **Mở năng lực**：khai thuế điện tử / xuất hóa đơn điện tử là năng lực trả phí, nhà cung cấp dịch vụ cấu hình theo doanh nghiệp phục vụ, doanh nghiệp gửi đơn mở, nền tảng duyệt;
  việc mở / đóng theo chiều doanh nghiệp và khớp tài khoản Qi Xiang Yun thống nhất tại hậu trường「quản lý tài chính thuế」.
- **Bảng nghiệp vụ**：danh sách **thông tin nhu cầu** của cácbảng tài chính thuế / cung tiêu / ra ngoài đều đọc sổ bản hệ thống (`market_listing_records`),
  không đọc thẳng bể công khai nền tảng nữa; hành động đăng qua kênh MCP thống nhất đồng bộ lên nền tảng AIworkin và ghi nhớ lại mã treo đơn nền tảng (ID nội dung)
  vào sổ cục bộ, bản ghi đã chính thức đăng lên nền tảng chỉ cung cấp「xem」trong bản hệ thống. **Cột dịch vụ** của cácbảng trên từ
  2026-11-09 thống nhất thành「**chợ dịch vụ ××**」, đọc sổ dịch vụ bản hệ thống (`provider_service_listings`) và chuyển được theo
  「tất cả dịch vụ / dịch vụ tôi đăng」(tất cả = bể công khai nền tảng), đăng cũng ghi kho trước rồi đồng bộ nền tảng và ghi nhớ lại mã treo đơn.
- **Chợ cung cầu**：lối vào menu nằm dưới「dịch vụ nghiệp vụ」, API tái dùng `/enterprise/market/:domain/...` và dùng
  `domain=HUB` để biểu thị xuyênbảng: hai tab nhu cầu / dịch vụ đều có bộ lọc「tất cả / do tôi đăng」——「tất cả」chỉ đọc **bể công khai** nền tảng
  (do đó chưa bind Key cũng không xuất hiện lỗi xác thực kênh), 「do tôi đăng」chỉ đọc sổ bản hệ thống (`scope=mine`, chỉ render với danh tính nhà cung cấp dịch vụ);
  cả hai đều hỗ trợ lọc khu vực (tỉnh / thành phố) và danh mục cấp hai (danh mục chọn được xuyên bất kỳbảng nghiệp vụ, danh mục cấp một hiển thị theo dòng);
  danh sách hiển thị theo trang, khi lật trang mới lấy tiếp đoạn con trỏ sau, không xếp cuộn dài bên phải danh sách;
  đăng dùng API Key AIPDD đã bind của tài khoản hiện tại ghi thẳng lên nền tảng và lưu sổ cục bộ, nội dung đăng cũng qua kiểm duyệt an toàn nội dung Alibaba Cloud tự động;
  bản ghi đã đăng lên nền tảng không sửa xóa được trong bản hệ thống, chỉ để「xem」.

### 5. Mạng xã hội doanh nhân (xã hội / tuyển dụng / cung cầu)

- **Xã hội doanh nhân**：kết bạn đồng nghiệp (bạn bè / chặn), đăng dòng thời gian (công khai / chỉ bạn bè), nhóm kiểu Douban (khám phá / tham gia nhóm, đăng bài theo danh mục,
  ẩn danh từng bài, trả lời theo tầng và đề xuất, nhóm trưởng / quản trị ghim tinh chọn và duyệt vào nhóm), tin nhắn riêng trong site, hồ sơ nghề nghiệp (trang HTML độc lập rẽ nhánh với trang chủ,
  gửi được trong tin nhắn riêng, nhà tuyển dụng mở ra là xem và xuất PDF). Khi tài khoản bịchặn thì năng lực xã hội tự động chặn.
- **Tuyển dụng**：đăng vị trí toàn thời gian / bán thời gian / thực tập / tạm thời / phái cử lao động vào dòng tin chợ tuyển dụng, kết nối bằng tin nhắn riêng trong site (kèm được hồ sơ),
  bản hệ thống không làm kho hồ sơ ATS và lọc; khi đã bind Key AIPDD có thể đồng bộ vị trí thành nhu cầu lao động AIworkin (danh mục cố định lấy nhánh con「lao động linh hoạt」).
- **Quảng trường cung cầu**：đăng nhu cầu / dịch vụ phổ quát, vào dòng tin cục bộ, duyệt được và kết nối bằng tin nhắn riêng.
  **Đăng hai giai đoạn** là chuẩn cốt lõi của dự án: mặc định đăng cục bộ miễn Key; khi tick「đăng đồng bộ lên AIworkin」thì
  qua bộ phân giảithông tin xác thực thống nhất gọi lên thượng nguồn `POST /market/listings` bằng Key người dùng bind, và phản chiếu trạng thái duyệt / thu hồi thượng nguồn.

### 6. Cài đặt quản lý

| Module | Nội dung |
|---|---|
| Danh tính và tư cách | Thông tin người dùng gửi là hiệu lực; hồ sơ nhà cung cấp dịch vụ cần duyệt; nhân viên cần liên kết hoặc trực thuộc |
| Quản lý nhân viên / đại lý | Tổng quan đội, duyệt trực thuộc và nhân viên đang làm; trong đó có danh mục đồng bộ kết nối IM (Feishu / WeCom) và callback |
| Quản lý ký kết | Tổng quan ký kết và toàn bộ ký kết (doanh nghiệp phát khởi, nhà cung cấp dịch vụ xác nhận) |
| Trung tâm điểm | Hiển thị hai loại tiền điểm và AWcoin, nạp, tặng, dòng tiền và đơn hàng; **mã khuyến mại** khấu trừ theo số tiền đơn hoặc quy đổi thành điểm (quản trị viên nền tảng duy trì bể mã, phía người dùng đổi là vào tài khoản) |
| Gói của tôi | Gói dịch vụ chính thức đã mua và tiến độ bàn giao từng mục: gói do nền tảng tích hợp nhà cung cấp chất lượng bàn giao, nền tảng chủ trì doanh nghiệp ký với nhà cung cấp, tiến độ đọc trạng thái ký kết thời gian thực |
| Lời mời của tôi | Mã mời riêng, link đăng ký, quan hệ mời và số người |

### 7. Quản trị nền tảng (`/admin`, 26 bảng)

Thanh bên tổ chức theo 5 nhóm lớn; tổng quan dữ liệu nền tảng gộp vào bảng điều khiển điều hành (`/dashboard`), thanh bên không giữbảng tổng quan độc lập nữa:

| Nhóm | Board | Mô tả |
|---|---|---|
| Người dùng và nhà cung cấp dịch vụ | Người dùng đăng ký | Toàn bộ tài khoản: tên đăng nhập, biệt danh, email, trạng thái tài khoản |
| Người dùng và nhà cung cấp dịch vụ | Người dùng doanh nghiệp | Người dùng đã qua xác thực thông tin doanh nghiệp (doanh nghiệp / hộ kinh doanh cá thể) |
| Người dùng và nhà cung cấp dịch vụ | Đăng ký nhà cung cấp dịch vụ | Duyệt đơn đăng ký, qua thì tự nhận vai trò nhà cung cấp dịch vụ |
| Người dùng và nhà cung cấp dịch vụ | Quản lý nhà cung cấp dịch vụ | Nhà cung cấp đã đăng ký và tư cách loại dịch vụ, tắt / phục hồi từng mục (tắt là tài nguyên xuống kệ và chặn nghiệp vụ mới của loại đó) |
| Người dùng và nhà cung cấp dịch vụ | Mở năng lực nhà cung cấp dịch vụ | Duyệt đơn mở trả phí tự động hóa tài chính thuế |
| Giám sát vận hành nghiệp vụ | Lao động linh hoạt | Bật tắt cấp nền tảng củabảng「trả lương lao động linh hoạt」(mặc định bật) |
| Giám sát vận hành nghiệp vụ | Giám sát ký kết | Sổ ký kết toàn bộ, giải trừ được ký kết đang hiệu lực |
| Giám sát vận hành nghiệp vụ | Giám sát mạng lưới cung tiêu | Tổng quan toàn nền tảng trạm dịch vụ, đặt hàng hóa và đơn đặt lịch dịch vụ |
| Giám sát vận hành nghiệp vụ | Giám sát mã sống | Danh sách mã sống toàn nền tảng: tài khoản sở hữu, tên miền lối vào, tổng lượt quét; vi phạm có thể xuống kệ |
| Giám sát vận hành nghiệp vụ | Cộng đồng sáng tạo | Duyệt và đề xuất luồng công việc cộng đồng, đề xuất xong tặng điểm cho người đăng (quy tắc cấu hình được) |
| Giám sát vận hành nghiệp vụ | Cộng đồng mẫu video | Có bổ sung hiển thị mẫu nền tảng AIworkin hay không (đồng bộ thủ công / theo lịch, đồng bộ ngay và kết quả đồng bộ gần nhất) |
| Giám sát vận hành nghiệp vụ | Quản lý tài chính thuế | Bể tài khoản API Key khai thuế Qi Xiang Yun và khớp mã số thuế, duyệt đơn mở trả phí |
| Giám sát vận hành nghiệp vụ | Cài đặt quản lý GEO | Lượng tác vụ thu thập GEO tự động mỗi tuần (kế hoạch / thực tế, chi tiết từng dự án) |
| Tính phí và sản phẩm | Điểm và nạp | Tỷ giá và bậc, thưởng đăng ký / mời, hạn mức tặng và kiểm soát rủi ro, bảng giá và lượng dùng module (đã đặt sẵn giá điểm cho các mục AI thấu hiểu / HRM / cơ sở tri thức / marketing / tuyển dụng / kiểm duyệt kỹ năng), điều chỉnh tài khoản và đơn nạp |
| Tính phí và sản phẩm | Gói dịch vụ | Danh mục gói dịch vụ chính thức (lên kệ cấpbảng, giá nhân dân tệ + giá điểm quy đổi theo tỷ giá, mục bàn giao và chọn một trong「nhà cung cấp đặt sẵn / phân bổ thủ công」; đặt sẵn chỉ tự phát khởi, vẫn cần nhà cung cấp xác nhận; giới hạn mua theo doanh nghiệp) và quản lý bàn giao: hàng đợi mua, khớp nhà cung cấp từng mục, nền tảng chủ trì phát khởi ký kết, đổi chủ thể, hoàn tiền một phần / toàn đơn |
| Tính phí và sản phẩm | Chợ mô hình | Danh mục mô hình và kênh thượng nguồn: kéo lên kệ theo baseURL kênh, định giá (đơn vị / bậc / giá cache / chiết khấu), sổ lượng dùng và gateway tương thích OpenAI |
| Tính phí và sản phẩm | Quyền lợi hạn mức | Danh mục quyền lợi và hạn mức gói: cấu hình tổng lượng / chu kỳ (ngày / tháng / năm) và chiến lược vượt hạn theo khóa chức năng, cấp phép từng mục cho chủ thể doanh nghiệp hoặc nhà cung cấp dịch vụ, tra được lượng dùng |
| Năng lực và bảo mật | Quản trị chức năng | Bật tắt danh mục chức năng, danh sách đen ra mạng của Agent và giới hạn cứng sandbox, sổ kiểm duyệt kỹ năng / plugin và thông qua thủ công, cổng AI (tổng cổng nền tảng + phủ tổ chức + giới hạn phút theo người dùng×tổ chức) |
| Năng lực và bảo mật | Sinh Skill | Tick miền nghiệp vụ và hành động MCP bản hệ thống, gọi mô hình sinh từng gói kỹ năng zip có `SKILL.md` ở thư mục gốc; tải về có thể phát hành lên SkillHub lấy lưu lượng, danh mục tự tăng theo API MCP |
| Năng lực và bảo mật | Duyệt phát hành | Cấu hình AccessKey an toàn nội dung Alibaba Cloud (lưu mã hóa, chỉ trả mặt nạ) và khu vực truy cập; đăng nhu cầu, đăng dịch vụ là tình huống bắt buộc, đăng bài cộng đồng, đăng hồ sơ bật theo nhu cầu. Sau khi bật bốn loại hành động đăng được gửi duyệt trước khi vào kho, trúng block / review từ chối thẳng và ghi sổ duyệt; thượng nguồn quá giờ hoặc lỗi thì giảm cấp cho qua và ghi ERROR, không chặn đăng bình thường |
| Năng lực và bảo mật | Điểm chôn dùng | Sổ sự kiện trang và hành động: lượng sự kiện tổng hợp theo ngày, số chủ thể độc lập và sự kiện Top, dùng cho tỷ lệ sử dụng chức năng và phân tích giữ chân |
| Năng lực và bảo mật | Phần cứng thông minh | Danh mục mẫu phần cứng, phiên bản dev kit (tải và lượng tải SDK / firmware) và duy trì công cụ API / MCP mặc định theo mẫu; thiết bị người dùng kết nối và công cụ tự dựng nằm ở mục「phần cứng thông minh」phía người dùng |
| Hệ thống và nội dung | Phiên bản điều khoản | Quản lý đa phiên bản điều khoản dịch vụ / chính sách riêng tư: nội dung rich text, thời gian hiệu lực, có bắt buộc chấp nhận lại không; bản ghi chấp nhận của người dùng ghi vào phiên bản, thời gian và IP |
| Hệ thống và nội dung | Nhật ký cập nhật | Changelog cấp sản phẩm: duy trì mục thêm mới / tối ưu / sửa lỗi theo phiên bản, công khai tại tab「nhật ký cập nhật」của `/help` |
| Hệ thống và nội dung | Nâng cấp nền tảng | Kéo từ GitHub Release hoặc tải thủ công gói nâng cấp vào `update/`, Agent nền tảng so sánh phiên bản hiện tại với gói nâng cấp và đưa rủi ro cùng đề xuất thực thi; sau xác nhận bắt buộc sao lưu cơ sở dữ liệu, mặc định đồng thời sao lưu mã và tự rollback, do trình thực thi độc lập hoàn thành đóng gói / build / migration / restart trong chế độ bảo trì; sổ sao lưu hỗ trợ phục hồi một chạm「toàn kho + mã」hoặc「chỉ cơ sở dữ liệu」 |
| Hệ thống và nội dung | Cài đặt hệ thống | Tệp lưu trữ (OSS) và sổ dung lượng (chiếm dụng, định giá, di trú tài sản lịch sử theo lô), Key nền tảng AIPDD, tham số cấp nền tảng, cài đặt site và cài đặt trang chủ (chuyển tab, lưu là hiệu lực; cài đặt trang chủ duy trì nội dung, ảnh và hiển thị board của trang đích website chính thức) |

### 8. Dịch vụ mô hình

- **Quản lý API Key**：hai bộ Key quản riêng——Key `ek_` của bản hệ thống dùng gọi API mở (`/api/v1`) và chợ mô hình, sinh / sao chép / đặt lại / thu hồi đều ở trang này,
  mỗi Key đặt riêng được「hạn mức điểm」(giới hạn tích lũy tiêu hao khi gọi ra ngoài, vượt là từ chối, cũng đặt được không giới hạn);
  AIPDD API Key (`sk-`) bind cùng trang, dùng cho năng lực thượng nguồn như đăng đồng bộ, đồng bộ dữ liệu nhà cung cấp dịch vụ, tài nguyên kết nối. Key lưu mật, chỉ bản thân copy được bất cứ lúc nào tại trang này, người khác không thấy.
- **Chợ mô hình** (`/model-plaza`)：danh mục mô hình khả dụng nền tảng lên kệ thống nhất——đơn vị tính phí đồng nhất với thượng nguồn (hội thoại / vector theo Token, ảnh theo tấm, video và nhận dạng giọng nói theo giây, tổng hợp giọng nói theo lần),
  dùng thử trực tuyến, xem sổ lượng dùng, và dùng Key `ek_` đi gateway tương thích OpenAI; danh mục, kênh thượng nguồn và định giá do hậu trường「tính phí và sản phẩm → chợ mô hình」duy trì.
  Hậu trường còn có tab「mô hình mặc định」: chỉ định mô hình mặc định nền tảng theo văn bản / thị giác / ảnh / video / nhận dạng giọng nói / tổng hợp giọng nói / vector, cấu hình hạn mức điểm theo lần, ngày, tháng và lưu bản ghi thay đổi;
  người dùng đã nạp thật và vào tài khoản, năng lực chưa cấu hình riêng sẽ tự kế thừa (chỉ nhận đơn nạp đã thanh toán, tặng và điều chỉnh không tính), khi gọi trừ điểm của bản thân theo giá danh mục.
- **API-MCP-Skill** (`/developer/api-mcp-skill`)：lối vào thống nhất của dịch vụ mô hình, ba tab xếp theo thứ tự này——
  **Skill**: danh sách gói kỹ năng quản trị viên nền tảng sinh theo miền nghiệp vụ (tên, mô tả, miền nghiệp vụ, số hành động bao phủ, mô hình sinh, thời gian cập nhật), nhấp「tải」là lấy zip;
  trong gói chỉ có hướng dẫn gọi và ví dụ, không chứa Key thật, sinh lại cùng tên thì ghi đè gói cũ, danh sách và tải đi cùng một cổng menu.
  **MCP Server**: Codex, Claude Desktop, Cursor, script tự phát triển và Workbuddy dùng cùng một API Key kết nối vào;
  máy chủ phân tích bộ nhớ agent của tài khoản này trước, rồi theo cấp phép tự thực thi hành động site này. Danh mục API sinh từ tầng khế ước, module mới (ERP mua bán tồn kho, bàn SEO, thu hút khách AI, SCRM WeCom, tác vụ dự án, HRM…) vào khế ước là tự vào `list_operations`;
  các hành động trực tiếp thay đổi sổ sách như kết luận phê duyệt, thu chi vốn, luồng tồn kho (gồm phê duyệt tồn kho / mua / nhập kho / hoàn ứng ERP, thu chi đối chiếu, luồng xuất nhập kho) nằm trong danh sách loại trừ vĩnh viễn, chỉ bản thân xác nhận được trên giao diện.
  **API**: danh mục API bản hệ thống thực tế cung cấp ra ngoài, sinh từ tầng khế ước, đồng nguồn với `list_operations` của máy chủ MCP và tài liệu OpenAPI.
  Địa chỉ cũ `/developer/docs`, `/developer/mcp` giữ chuyển hướng, lần lượt rơi vào `?view=api` và `?view=mcp`.
- **Cài đặt mô hình**：cấu hình mô hình dùng chung của Agent và sáng tạo nội dung——kênh tích hợp AIPDD dùng thẳng Key sk-, cũng nối được gateway tương thích OpenAI khác và Volcano MediaKit, và chọn mô hình mặc định cho từng loại;
  đầu trang hiển thị tình trạng hiệu lực hiện tại của「mô hình mặc định nền tảng」(khi cá nhân chưa cấu hình thì kế thừa theo tư cách nạp) và hạn mức đã dùng hôm nay / tháng này.
  Quản trị viên nền tảng đặt được phạm vi hỗ trợ của các kênh năng lực tính toán tại「chợ mô hình → kênh người dùng」(mặc định hỗ trợ tất cả): kênh bị tắt thì người dùng không thêm / sửa được, cũng không chọn được;
  tắt AIPDD chỉ dừng năng lực tính toán của nó (cài đặt mô hình / chợ mô hình), các chức năng khác (dịch vụ nghiệp vụ…) dùng cùng một API Key AIPDD vẫn chạy bình thường.
- **Cơ chế nền tảng**：lối vào thống nhất của năng lực ngang §5.8——Outbox sự kiện và đăng ký Webhook (thử, bản ghi gửi, gửi lại khi thất bại; danh mục sự kiện bao phủ nút nghiệp vụ như tác vụ, dự án, khách tiềm năng / đơn hàng / thu tiền CRM, nhu cầu gửi ngoài, hợp tác ngoài), nhập CSV (ánh xạ trường, chạy thử, tái dùng phương án ánh xạ) và xuất theo module (tệp xuất không còn link công khai dài hạn, đổi thành endpoint trạng thái đăng nhập trả về theo quyền tổ chức hiện tại), danh mục báo cáo, máy quy tắc (khớp điều kiện + gọi Webhook / thông báo / thấu hiểu / tạo tác vụ), chia sẻ công khai (mật khẩu, thời hạn, tắt; mỗi lần mở đều đối chiếu tư cách còn hiệu lực của người tạo, người phát khởi nghỉ việc / bị loại khỏi tổ chức là mất hiệu lực), nguồn danh tính OIDC (thử phát hiện, tự mở tài khoản), chiến lược chia sẻ tệp đính kèm, đồng bộ danh bạ - chấm công - tin thẻ của Feishu / WeCom, cùng lưu vết chấp nhận điều khoản (chưa chấp nhận phiên bản mới thì toàn site nhắc), điểm chôn dùng sản phẩm (sự kiện trang / hành động và bảng tổng hợp) và bộ chuyển chủ thể (cùng một tự nhiên nhân chuyển phạm vi HRM xuyên doanh nghiệp / nhà cung cấp dịch vụ), phó lái nhận biết trang (lối vào nổi toàn site). Tab nghiệp vụ toàn site thống nhất thành viên nang xuống dòng (`PanelTabs` / `TabStrip`), không trộn antd Tabs nữa.
- **Trung tâm trợ giúp**：`/help` cơ sở tri thức phân chương duy trì theo phiên bản code (tệp tri thức ở `backend/src/help`), bao phủ cách dùng từng module; cùng trang còn có tab「nhật ký cập nhật」hiển thị changelog cấp sản phẩm; nội dung tri thức mở bằng ba hành động chỉ đọc MCP `Help_chapters / Help_topic / Help_search`, người dùng hỏi thẳng Agent cũng lấy được cách dùng chính thức.
- **Ảnh chụp OpenAPI**：`/api/openapi.json` (1947 hành động), CI kiểm chứng khớp với ảnh chụp trong kho.

### 9. Phần cứng thông minh

Board **phần cứng thông minh** độc lập ở thanh bên (nhóm cấp một, xếp sau cài đặt quản lý): người dùng duyệt phần cứng và dev kit, đưa thiết bị trong tay vào nền tảng, và gọi công cụ MCP (Agent điều khiển) cùng API (chương trình điều khiển) **chuyên dụng** theo loại phần cứng; quản trị viên nền tảng duy trì danh mục mẫu, phiên bản dev kit và công cụ mặc định theo mẫu.

- **Quảng trường phần cứng** (`/hardware`)：danh mục mẫu hiển thị theo đề xuất / sắp xếp, mỗi mẫu đưa ra thông số, phiên bản dev kit (kênh ổn định / xem trước) và tải về; nhị phân dev kit tải trực tiếp vào OSS site này, đếm khi tải, trang đưa SHA-256 để kiểm chứng; vào chi tiết mẫu xem được danh mục công cụ API / MCP mặc định của mẫu đó.
- **Thêm phần cứng** (`/hardware/devices`)：chọn mẫu để vào thiết bị, sinh token thiết bị bắt đầu bằng `hw_` (bản rõ chỉ hiển thị một lần lúc sinh, kho chỉ lưu SHA-256); thiết bị điền địa chỉ dịch vụ và token theo SDK / firmware trong dev kit rồi heartbeat lên tuyến, danh sách hiển thị theo ba trạng thái online / offline / chưa từng báo cáo (quá 180 giây không heartbeat chuyển offline), và xem được luồng heartbeat / lệnh / hồi đáp theo thiết bị để xử lý sự cố.
- **MCP phần cứng** (`/hardware/mcp`)：máy chủ MCP phần cứng độc lập `aiworkin-hardware-mcp` (endpoint `/api/v1/hardware/mcp`), tách hoàn toàn với MCP nền tảng——công cụ chỉ đến từ bảng công cụ phần cứng, đặt tên `hw__<mã mẫu>__<mã công cụ>`, xác thực bằng Key `ek_` của「nhà phát triển → API Key」. Công cụ ghi đi cổng cấp phép ba lớp: chưa tick「tự động thực thi được」tại trang này, đến từ tác vụ theo lịch không người trực, hoặc bên gọi khai báo dryRun, một mực chỉ trả bản nháp, không thực sự gửi xuống; 「thử điều」của bản thân không bị hạn chế này.
- **API phần cứng** (`/hardware/api`)：cùng một lô công cụ dùng Key `ek_` đi kênh máy `/api/v1/hardware/**`, `curl` là liệt kê và gọi được; tham số và phản hồi công cụ lấy ví dụ JSON trang đưa ra làm chuẩn.
- **Dev Kit**：thư mục gốc kho `hardware-devkit/` cung cấp SDK và ví dụ biên dịch chạy được ngay——thành phần ESP-IDF của ESP32, gói Python thuần thư viện chuẩn cho Jetson / Raspberry Pi, hai ví dụ chạy được, cùng một thiết bị mô phỏng Node không phụ thuộc (không có phần cứng cũng chạy thôngkhép kín「heartbeat → kéo lệnh → hồi đáp」) và tài liệu giao thức từng trường; firmware biên dịch sẵn bổ sung sau khi lô máy thật đầu tiên biên dịch.
- **Bảo trì hậu trường**：board「phần cứng thông minh」của quản trị viên nền tảng chia ba tab「mẫu phần cứng / dev kit / công cụ mặc định」——duy trì danh mục mẫu, tải dev kit các phiên bản, duy trì công cụ API / MCP mặc định theo mẫu, sửa xong phía người dùng thấy ngay. Công cụ người dùng tự dựng chỉ bản thân thấy dùng được, không vào công cụ mặc định của mẫu, phiên bản đầu cũng không lên kệ chợ.

Kênh thiết bị (`/api/public/hardware/heartbeat`, `/commands`, `/result`) chỉ nhận token thiết bị, miễn đăng nhập, **cố ý không bị cổng công tắc chức năng chặn**: khi quản trị viên tắt board「phần cứng thông minh」, heartbeat của thiết bị đã vào không bị cắt.

### 10. Điểm và tính phí

- **Điểm**：nạp qua WeChat, tặng giữa tài khoản, bảng giá module và trừ theo lượng dùng (lưu trữ tài sản số, CRM / BI / OA / CSKH AI), dòng tiền và đơn nạp xem được một màn hình; đã đặt sẵn giá cho các mục AI thấu hiểu / HRM / cơ sở tri thức / marketing / tuyển dụng / kiểm duyệt kỹ năng, hiệu lực theo module tương ứng lên tuyến.
- **Đế lưu trữ**：tệp đính kèm và tài sản số thống nhất tải trực tiếp vào OSS Alibaba Cloud site này (không qua trung chuyển thượng nguồn nữa); trang tài sản xóa được từng mục, hậu trường「cài đặt hệ thống → lưu trữ tệp」hiển thị dung lượng, định giá và di trú tài sản lịch sử theo lô (ngắt được chạy tiếp, thất bại thử lại được).
- **AWcoin**：chỉ đọc hiển thị số dư và nguồn, **không bao giờ quy đổi lẫn nhau**.
- **Cấu hình hậu trường**：tỷ giá và bậc nạp, thưởng đăng ký / mời, hạn mức tặng và kiểm soát rủi ro, bảng giá từng module, điều chỉnh tài khoản và tra đơn hàng.

### 11. Đa ngôn ngữ, site và thông báo

- **8 ngôn ngữ giao diện**：简体中文 · English · Tiếng Việt · 日本語 · العربية · Français · Español · Русский;
  quản trị viên đặt được ngôn ngữ mặc định của site, khách chuyển bất cứ lúc nào, tiếng Ả Rập toàn site RTL.
- **Ưu tiên ba cấp tên miền site**：hậu trường「cài đặt site → tên miền site」＞ `SITE_URL` ＞ địa chỉ khách truy cập hiện tại;
  địa chỉ tuyệt đối như endpoint MCP / API, callback IM, script nhúng CSKH, lối vào mã sống, link mời đều ghép theo đây (xem「tên miền site」bên dưới).
- **Hiển thị menu**：mỗi menu thanh bên phía trước (lối vào bảng điều khiển + mỗi nhóm, gồm link ngoài「nền tảng năng lực tính toán AIPDD」) đều tick ẩn được từng mục tại hậu trường「cài đặt site → hiển thị menu phía người dùng」; sau khi mọi mục trong một nhóm đều ẩn thì nhóm đó tự biến mất (chỉ ẩn menu, link vẫn truy cập được).
- **Hiển thị tab board**：tab「thông tin nhu cầu」「chợ dịch vụ」của 12 trang board「dịch vụ nghiệp vụ」(marketing / cung tiêu / tài chính thuế / ra ngoài / lao động linh hoạt / logistics / IT / sở hữu trí tuệ / pháp lý / think tank / giao dịch tài sản / chợ cung cầu), tick ẩn được từng board tại hậu trường「cài đặt site → tab board dịch vụ nghiệp vụ (tick là ẩn)」; cùng chuẩn với hiển thị menu——ẩn đồng nhất với mọi danh tính (gồm quản trị viên), chỉ kiểm soát hiển thị (link trực tiếp và API không bị hạn chế).
- **Lối vào plugin trình duyệt trên đỉnh**：biểu tượng thống nhất ngang hàng với thông báo, dịch vụ WeChat ở thanh trên, là lối vào tải và cài đặt duy nhất của ứng dụng khách cấp nền tảng (AIPDD Enterprise)——phân phối marketing, thu hút khách AI, trình duyệt tác tử (Chrome cục bộ), trang sản phẩm / SEO sau này… dùng chung, không tự làm popup「cài plugin」riêng nữa. Mở drawer có bốn tab: tải và cài đặt (phiên bản hiện tại, phiên bản tương thích tối thiểu, trình duyệt hỗ trợ, gói cài, bước cài), hướng dẫn dùng (lối vào năng lực từng nghiệp vụ và câu hỏi thường gặp), nhật ký cập nhật, site đã cấp phép (xem / thu hồi site plugin tin cậy). Mở là tự bắt tay phát hiện (không nút làm mới thủ công), chưa cài đưa hướng dẫn cài từng bước, phiên bản quá thấp thì biểu tượng có chấm nhắc và dẫn cập nhật; khi phát hiện bị trình duyệt hạn chế có thể「tôi đã cài」xác nhận thủ công, nhưng trước khi thực thi nghiệp vụ vẫn bắt tay xác thực thật. Khi nền tảng chưa phát hành gói plugin hoặc quản trị viên tắt tại「cài đặt site → lối vào plugin trình duyệt trên đỉnh」thì cả biểu tượng không render; địa chỉ gói cài ghép theo cấu hình tên miền site, không hard-code tên miền khách nào.
- **Tin nhắn hệ thống**：sáu loại sự kiện CSKH, nhu cầu và cơ hội, danh tính và ký kết, tài chính thuế và khai báo, tự động hóa và tích hợp, tài khoản và nền tảng nhắc tập trung.

---

## 🧱 Công nghệ và kiến trúc

- **Backend**：[Hono 4](https://hono.dev) + `@hono/zod-openapi`, Prisma 5.22, MySQL 8 / PostgreSQL, Zod 4, Node.js ≥ 24
- **Frontend**：Next.js 16 (App Router) + React 19 + Ant Design 6 / Pro Components + `@tanstack/react-query` 5
- **Tầng khế ước**：`packages/contracts` là nguồn sự thật duy nhất của frontend - backend, MCP, OpenAPI (1947 hành động, mã lỗi, danh mục MCP)
- **Xác thực**：phiên SSO tự ký site này (khóa dẫn xuất HKDF + đối chiếu phiên bản tài khoản) + Key `ek_` API mở + ba kênh tách riêng Key `sk-` AIPDD thượng nguồn
- **Quyền dữ liệu**：dữ liệu một mực treo dưới khóa tổ chức `(orgType, orgUserId)`, danh sách / chi tiết / xuất / tệp đính kèm / AI / tác vụ theo lịch trước khi lấy dùng đều đối chiếu thống nhất「tài khoản còn hiệu lực + tổ chức còn hiệu lực」(`HrmScopeService.isStanding`), nhân sự nghỉ việc hoặc đổi vai trò là mất hiệu lực tức thời, không phụ thuộc dọn dẹp bất đồng bộ hay bộ nhớ đệm; quyền hàng cột BI vào cùng chuẩn của truy vấn thực tế, xem trước, biểu đồ và hỏi số AI (lọc hàng theo placeholder `${userId}` / `${deptId}`, quyền cột ẩn cột bị loại bỏ một mực trước kết quả và trước khi đưa mô hình); ngữ cảnh tổ chức chỉ đi dịch vụ phân giải tenant thống nhất (`TenantScopeService.preferred`), CRM / BI / OA dùng chung một bộ chuẩn「chủ thể hiện tại」với HRM / OKR——bộ chuyển chủ thể trên đỉnh chọn và quan hệ còn hiệu lực thì ưu tiên dùng, sau chuyển phạm vi dữ liệu các module đồng nhất

```
Trình duyệt ── Next.js (SSR/CSR, /api/backend/* proxy ngược cùng nguồn)
             │
             ├── Hono API (/api/backend nghiệp vụ, /api/v1 API mở và MCP, /api/public endpoint công khai)
             │        ├── Tài khoản / danh tính / phiên   ├── Bàn làm việc (CRM·BI·OA·OKR·RPA·bảng…)
             │        ├── Dịch vụ nghiệp vụ 11 dây         ├── Xã hội / tuyển dụng / cung cầu
             │        ├── Đế điểm và lưu trữ OSS           └── Hậu trường nền tảng
             │        └── Kênh thượng nguồn (AIPDD / AIworkin, Key người dùng hoặc Key nền tảng)
             └── Prisma ── MySQL 8 / PostgreSQL (514 mô hình, 52 migration)
```

## 📁 Cấu trúc thư mục

```
oem-enterprise/
├── backend/                 # Hono API
│   ├── prisma/              # schema.prisma (514 mô hình) + migrations/ (52) + seed
│   └── src/                 # 91 module nghiệp vụ
│       ├── http/ account/ identity/ auth/    # lắp ráp (routes.ts là gốc tổ hợp, route tách theo domain trong route-groups/), tài khoản, danh tính, phiên
│       ├── aiworkin/ content/ agent-memory/  # kênh thượng nguồn, Agent, sáng tạo nội dung và tài sản số
│       ├── ecom-pdp/ domestic-pdp/           # bộ ảnh tối ưu trang sản phẩm TMĐT xuyên biên giới / trong nước
│       ├── crm/ bi/ oa/ okr/ data-table/ rpa/ workbuddy/ livecode/ lowcode/
│       ├── social/ sns/ supply/ marketing/ logistics/ tax/ flex/ overseas/
│       ├── legal/ ip/ think-tank/ asset/ smart-service/                       # dây dịch vụ nghiệp vụ
│       ├── points/ oss/ asset/               # tính phí điểm và lưu trữ
│       ├── mcp/ openapi/                     # API mở và máy chủ MCP
│       ├── hardware/                         # phần cứng thông minh (mẫu / dev kit / thiết bị / công cụ / MCP phần cứng độc lập)
│       ├── admin/ platform/                  # hậu trường nền tảng và cài đặt site
│       └── common/ shared/                   # thích ứng phương ngữ, mã lỗi, xác thực,thông tin xác thực thượng nguồn
├── frontend/                # ứng dụng Next.js (73 route trang, /social /admin…)
├── packages/contracts/      # khế ước chia sẻ frontend - backend, mã lỗi, danh mục MCP
├── hardware-devkit/         # mã nguồn dev kit phần cứng thông minh (thành phần ESP-IDF / SDK Python / ví dụ / mô phỏng / tài liệu giao thức)
├── scripts/                 # cài đặt, migration, kiểm chứng và script smoke
├── infra/                   # nginx / mẫu triển khai
└── docs/                    # thiết kế tổng thể, ảnh chụp OpenAPI, baseline route, ảnh chụp và tài nguyên mã QR
```

Lắp ráp HTTP backend hai tầng: `http/routes.ts` chỉ làm gốc tổ hợp (gọi 27 hàm đăng ký theo domain), route cụ thể ở
`http/route-groups/` tách theo module (crm, okr, project, erp, hrm, oa, kb, data-table, marketing, scrm, admin…);
ba dịch vụ lớn OKR, cơ chế nền tảng, dự án cũng tách tệp theo domain + facade mỏng, `okr.service.ts` / `mechanism.service.ts` /
`project.service.ts` chỉ giữ chuyển tiếp phương thức công khai, hiện thực nghiệp vụ rơi ở `*.base.ts` cùng thư mục và các dịch vụ đặc tính.

---

## 🚀 Bắt đầu nhanh (phát triển cục bộ)

Chuẩn bị: Node ≥ 24, pnpm ≥ 10, một thực thể **MySQL 8 hoặc PostgreSQL** truy cập được (chọn một).

### Cách A: cài đặt một chạm (khuyến nghị, chọn được cơ sở dữ liệu)

```bash
pnpm install
pnpm setup            # tương tác: chọn MySQL / PostgreSQL → điền thông tin kết nối → ghi backend/.env → sinh client → tạo bảng
# hoặc không tương tác: pnpm setup --db postgres --host 127.0.0.1 --port 5432 --user app --password *** --database enterprise --yes
pnpm dev:api & pnpm dev:web
```

`pnpm setup` sẽ: ① ghi `DATABASE_URL` và `DB_PROVIDER` vào `backend/.env`; ② MySQL đi lịch sử migration `prisma migrate deploy`, PostgreSQL do `schema.prisma` dẫn xuất `schema.postgres.prisma` rồi `prisma db push`; ③ sinh Prisma Client theo phương ngữ đã chọn.

> Client và câu lệnh tạo bảng của Prisma sinh theo phương ngữ: sau khi đổi cơ sở dữ liệu chạy lại `pnpm setup` (hoặc `pnpm --filter aiworkin-enterprise-api prisma:generate:pg`) là được.

### Cách B: cấu hình thủ công

```bash
# 1) Cài phụ thuộc (sẽ kích hoạt prisma generate)
pnpm install

# 2) Cấu hình biến môi trường backend
cp backend/.env.example backend/.env
#   Sửa backend/.env: đặt DATABASE_URL (MySQL hoặc PostgreSQL), DB_PROVIDER, JWT_SECRET, EXTERNAL_CRED_KEY
#   (JWT_SECRET / EXTERNAL_CRED_KEY là chuỗi ngẫu nhiên cục bộ, thiếu thì backend từ chối khởi động)

# 3) Cấu hình biến môi trường frontend
cp frontend/.env.example frontend/.env.local

# 4) Khởi tạo cơ sở dữ liệu (migration / db push + sinh client)
#   MySQL：
pnpm --filter aiworkin-enterprise-api prisma:migrate:deploy
pnpm --filter aiworkin-enterprise-api prisma:generate
#   PostgreSQL (đổi sang schema dẫn xuất)：
pnpm --filter aiworkin-enterprise-api db:push:pg

# 4b) (tùy chọn) Nạp dữ liệu demo: hồ sơ doanh nghiệp / danh bạ nhà cung cấp dịch vụ / luật sư·sở hữu trí tuệ·lao động linh hoạt / cung tiêu marketing…
#      Chỉ dùng để hiển thị danh bạ và chi tiết; danh tính demo không phải tài khoản đăng nhập được, sau đăng nhập vẫn xin dùng tài khoản cục bộ đăng ký ở bước 5.
pnpm --filter aiworkin-enterprise-api prisma:seed

# 5) Chạy backend (mặc định 1690) và frontend (mặc định 15890)
pnpm dev:api
pnpm dev:web
```

Mở trình duyệt `http://127.0.0.1:15890`, đăng ký một tài khoản cục bộ là vào được xã hội và quảng trường cung cầu.
Frontend qua máy chủ Next.js proxy ngược `/api/backend/*` sang backend, phía trình duyệt giữ cùng nguồn.

### Tạo quản trị viên nền tảng (bắt buộc khi triển khai lần đầu)

Quản trị viên nền tảng **không** được tạo tự động khi cài / khởi động, cần tạo tường minh bằng `backend/scripts/seed-admin.ts` (lũy đẳng, `--reset` đặt lại mật khẩu):

```bash
# 1) Đặt ADMIN_USERNAME / ADMIN_PASSWORD trong backend/.env
# 2) Thực thi (tạo lần đầu; có tài khoản cùng tên thì bỏ qua)
pnpm --filter aiworkin-enterprise-api exec tsx scripts/seed-admin.ts
```

Sau khi tạo thì đăng nhập bằng tài khoản đó, thanh bên xuất hiện lối vào hậu trường nền tảng; chưa tạo thì chỉ đăng ký được người dùng thường, không vào được hậu trường nền tảng.

### Biến môi trường then chốt

| Biến | Mô tả |
|---|---|
| `DATABASE_URL` | Chuỗi kết nối cơ sở dữ liệu: MySQL `mysql://user:pass@127.0.0.1:3306/enterprise` hoặc PostgreSQL `postgresql://user:pass@127.0.0.1:5432/enterprise?schema=public` |
| `DB_PROVIDER` | `mysql` / `postgres`: căn cứ nhánh phương ngữ SQL gốc (số chứng từ tự tăng, lấy giá trị cột JSON); thiếu thì suy từ giao thức `DATABASE_URL` |
| `PORT` | Cổng lắng nghe backend, mặc định `1690` |
| `JWT_SECRET` / `JWT_ISSUER` | Khóa ký phiên cục bộ, production bắt buộc thay bằng giá trị ngẫu nhiên |
| `EXTERNAL_CRED_KEY` | Khóa dẫn xuất AES-256-GCM của Key AIPDD /thông tin xác thực báo ngoài, cấu hình riêng, không fallback về JWT_SECRET |
| `AIPDD_PLATFORM_KEY` | Dự phòng triển khai của APIKey AIPDD cấp nền tảng (kênh dữ liệu cơ sở); sau khi lưu tại hậu trường「cấu hình hệ thống → Key nền tảng AIPDD」lấy mật trong kho làm chuẩn |
| `AIWORKIN_BASE_URL` / `AIWORKIN_ENABLED` | Địa chỉ chợ thượng nguồn và công tắc (tắt thì chỉkhép kín cục bộ dùng được) |
| `CORS_ORIGIN_PATTERNS` | Nguồn xuyên miền được phép (phân tách bằng dấu phẩy) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Tài khoản mật khẩu đọc khi chạy script `seed-admin` tạo quản trị viên nền tảng (không tự tạo khi khởi động) |

> Mọi khóa chỉ lưu `.env` máy cục bộ (đã trong `.gitignore`), API nào cũng không bao giờ trả lại bản rõ Key AIPDD.

### Tương thích cơ sở dữ liệu (MySQL / PostgreSQL)

Hệ thống khi cài chọn một trong hai, khi chạy lấy `DB_PROVIDER` làm chuẩn (thiếu thì suy từ giao thức `DATABASE_URL`), nghiệp vụ chạy tương đương trên cả hai. Để san phẳng khác biệt phương ngữ đã làm như sau:

- **Nguồn sự thật schema duy nhất**：lấy `prisma/schema.prisma` (MySQL) làm chuẩn, khi cài PostgreSQL do `scripts/gen-prisma-schema.mjs` dẫn xuất xác định `schema.postgres.prisma` (`provider=postgresql`, `@db.TinyInt→@db.SmallInt`, `@db.DateTime→@db.Timestamp`). MySQL đi lịch sử migration tạo bảng, PostgreSQL đi `prisma db push`.
- **Số chứng từ tự tăng**：`document-number.ts` phân nhánh theo phương ngữ——MySQL dùng `INSERT IGNORE`+`LAST_INSERT_ID`, PostgreSQL dùng `ON CONFLICT DO NOTHING`+`UPDATE … RETURNING`.
- **Lấy giá trị cột JSON**：`common/sql-json.ts` của `jsonText()` sinh đường dẫn `->>` theo phương ngữ (PostgreSQL `col->>'key'` / MySQL `col->>'$.key'`), dùng cho truy vấn khử trùng lặp xuyên tác vụ của lấy số dữ liệu lớn và khai thác khách tiềm năng.
- **Hỏi số / biểu đồ BI**：`internalScope()` của `bi/bi.internal.ts` gửi placeholder theo phương ngữ (PostgreSQL `$1`/`ANY($2::text[])` / MySQL `?`); tham chiếu định danh biểu đồ của `bi.query.service.ts` chọn theo thư viện đích (nháy kép PG / dấu huyền MYSQL của thư viện ứng dụng hoặc nguồn dữ liệu ngoài).
- **Sinh client**：`postinstall` đi `scripts/prisma-generate-auto.mjs`, theo `DB_PROVIDER`/`DATABASE_URL` tự chọn schema mặc định hoặc dẫn xuất để sinh, tránh client PG bị bản MySQL ghi đè khi cài lại phụ thuộc.
- **Chữ hoa chữ thường tên đăng nhập**：đăng nhập và ràng buộc duy nhất chuẩn hóa về **chữ thường** đồng nhất (MySQL mặc định collation không phân biệt hoa thường, PostgreSQL phân biệt), email cũng lưu chữ thường, đảm bảo hành vi đăng nhập / tra trùng hai kho đồng nhất; tài khoản chữ hoa chữ thường hỗn hợp tồn tại trước khi sửa vẫn đăng nhập được trên MySQL (CI bắt), kho tồn tại chạy được `pnpm --filter aiworkin-enterprise-api db:normalize-usernames` phục hồi một lần (lũy đẳng, hai kho dùng chung, trùng tên thì bỏ qua và liệt kê nhắc).

> Khác biệt đã biết: tìm văn bản tự do (từ khóa `contains`) trên MySQL không phân biệt hoa thường, PostgreSQL phân biệt——`mode:'insensitive'` của Prisma không được trình kết nối MySQL hỗ trợ, nên không ép thống nhất toàn bộ câu tìm kiếm. Nội dung chính như tiếng Trung không chứa hoa thường, không bị ảnh hưởng; nếu muốn tìm tiếng Latinh cũng đồng nhất, có thể tạo kho PostgreSQL với collation ICU không phân biệt hoa thường, hoặc chuẩn hóa chữ thường trường tương ứng rồi truy vấn.

---

## 🐳 Docker Compose (gồm MySQL)

`docker-compose.yml` thư mục gốc điều phối ba dịch vụ **MySQL + backend + frontend**, phù hợp trải nghiệm một chạm:

```bash
# Mọi phụ thuộc dịch vụ đều có giá trị demo cục bộ (${VAR:-default}), kéo lên là chạy:
docker compose up --build
# Khi cần tùy chỉnh mật khẩu / tên miền, tạo .env ở thư mục gốc để ghi đè MYSQL_* / JWT_SECRET / EXTERNAL_CRED_KEY…
# Backend http://localhost:1690  Frontend http://localhost:15890
```

Lần khởi động đầu backend tự chạy `prisma migrate deploy` tạo bảng. Sau lần khởi động đầu còn cần tạo quản trị viên nền tảng trong container (compose đã tiêm
`ADMIN_USERNAME` / `ADMIN_PASSWORD`, mặc định `admin` / `admin-Startup-2026`, ghi đè được trong `.env` thư mục gốc):

```bash
docker compose exec api pnpm --filter aiworkin-enterprise-api exec tsx scripts/seed-admin.ts
```

Triển khai production xin thay `JWT_SECRET` / `EXTERNAL_CRED_KEY`
bằng giá trị ngẫu nhiên mạnh, và dùng cơ sở dữ liệu cùng reverse proxy độc lập (`infra/nginx/` cung cấp cấu hình mẫu).

---

## 🌐 Tên miền site (địa chỉ truy cập ra ngoài)

Toàn site không viết cứng địa chỉ máy cục bộ: endpoint MCP / API, link callback IM và「đi xử lý」của thẻ, script nhúng CSKH trực tuyến,
lối vào mã sống, link mời, giá trị gợi ý callback thanh toán… địa chỉ tuyệt đối đều ghép theo ưu tiên sau:

1. Giá trị điền ở「hậu trường quản trị nền tảng → cài đặt site → tên miền site」(chỉ nhận http/https, kèm được cổng, lưu kho là hiệu lực, không cần khởi động lại)
2. Biến môi trường backend `SITE_URL`
3. Địa chỉ khách truy cập hiện tại (`window.location.origin`, triển khai một tên miền không cần cấu hình gì)

Phát triển cục bộ không cần điền gì: môi trường dev do Next proxy ngược `/api/*`, môi trường production do Nginx lấy `/api/*` trước,
nên endpoint kiểu `https://tên-miền-của-bạn/api/v1/mcp` đều thành lập ở cả hai hình thái.
Sau khi đổi tên miền ở hậu trường, tên miền đó tự vào danh sách trắng CORS / kiểm chứng nguồn; bản thân biến `SITE_URL` đổi vẫn cần khởi động lại.

---

## 🔑 Bind API Key AIPDD và kênh thượng nguồn

- Người dùng bind một API Key (`sk-`) do nền tảng AIPDD cấp ở khối「bind API Key AIPDD」trang「dịch vụ mô hình → quản lý API Key」;
  nhiều người dùng bind được cùng một Key (N:1, gộp theo dấu vân tay), mật lưu kho bằng AES-256-GCM.
  Trang độc lập cũ「bind Key AIPDD」(`/developer/aipdd`) đã gộp vào quản lý API Key, địa chỉ cũ chuyển hướng về `/developer/keys`.
  Hai trang này (quản lý API Key / cài đặt mô hình) thuộc tự trợ cấp tài khoản, **thanh bên dưới danh tính quản trị viên nền tảng không hiển thị**, muốn cấu hình xin chuyển sang danh tính doanh nghiệp / cá nhân (Key cấp nền tảng ở「cấu hình hệ thống → Key nền tảng AIPDD」), link truy cập trực tiếp vẫn dùng được.
- Cùng khối này gánh hướng dẫn đăng ký: sau khi quản trị viên điền mã giới thiệu AIPDD ở「cài đặt site」, người dùng mới theo hướng dẫn vào www.aipdd.work đăng ký và điền mã đó
  được tặng năng lực tính toán (hoa hồng mời về quản trị viên); dùng env `AIPDD_REFERRAL_CODE` đặt mã mặc định, `AIPDD_REGISTER_URL` ghi đè địa chỉ đăng ký (chỉ nhận http/https).
- `backend/src/common/upstream-token.ts` là **lối vàothông tin xác thực duy nhất** truy cập thượng nguồn: code nghiệp vụ không còn lấy token phiên cục bộ làmthông tin xác thực thượng nguồn,
  mà đổi thành Key người dùng bind; người dùng chưa bind khi kích hoạt hành động thượng nguồn nhận `403` dẫn dắt (đăng cục bộ không bị ảnh hưởng).
- **Dữ liệu cơ sở đi Key nền tảng, không đi Key người dùng**：dữ liệu tham chiếu như từ điển tỉnh thành, mục từ điển nền tảng không liên quan danh tính người dùng, do quản trị viên tại
  「hậu trường quản trị nền tảng → cấu hình hệ thống → Key nền tảng AIPDD」cấu hình thống nhất một Key nền tảng (cùng một bộ kiểm chứng định dạng `sk-` và xác thực trực tuyến,
  mật AES-256-GCM rơi `system_settings.aipdd_platform_key`, chỉ trả mặt nạ, ưu tiên cao hơn env `AIPDD_PLATFORM_KEY`,
  và bị cô lập đọc ghi bởi API tham số hệ thống phổ quát). Chuỗi phân giải: Key nền tảng → Key bản thân bind → đều không có thì vùng rơi về từ điển tỉnh thành tích hợp cục bộ
  (`backend/src/shared/region-dictionary.ts`, nguồn dữ liệu `GEO_CENTERS`), nên chưa cấu hình Key nền tảng cũng không kẹt biểu mẫu,
  nhưng mục từ điển nền tảng vẫn cần Key.
- Đăng nhu cầu, đồng bộ thượng nguồn, tài nguyên kết nối… **hành động người dùng vẫn dùng Key tự bind**, không bị Key nền tảng ảnh hưởng.
- `AIPDD_KEY_VERIFY=off` thì bind không xác thực trực tuyến (tiện demo ngoại tuyến); đặt chế độ trực tuyến sẽ gọi thượng nguồn xác minh.

---

## 🧪 Build, kiểm thử và CI

Kiểm thử đơn vị backend chạy dưới `backend/test/jest-unit.json` (ts-jest), kiểm thử thành phần frontend dùng Vitest + Testing Library (jsdom), CI còn chạy mẫu môi trường, ảnh chụp OpenAPI, kiểm chứng tải lên và migration:

```bash
pnpm --filter aiworkin-enterprise-api test          # kiểm thử đơn vị backend (102 suite / 862 ca qua, 15 ca bỏ qua theo môi trường)
pnpm --filter aiworkin-enterprise-web test          # kiểm thử thành phần frontend (bản mục tiêu / tách AI / khách hàng 360 / dự án 360)
pnpm test:uploads                                   # kiểm chứng tải tệp đính kèm và ảnh hóa đơn
pnpm test:environment                               # mẫu triển khai và chuẩn biến môi trường
pnpm api:docs:check                                 # ảnh chụp OpenAPI có khớp tầng khế ước không
pnpm lint                                           # chuẩn code + prettierđịnh dạng, cổng cứng CI
pnpm build                                          # contracts → backend tsc → frontend next build
```

- **Giới hạn heap build frontend**：`build`, `typecheck` và `lint` đều đi `frontend/scripts/with-heap.mjs`, mặc định
  `--max-old-space-size=10240` (heap khoảng 4GB mặc định khi biên dịch nguội 55 trang hoặc chạy lint nhận biết kiểu sẽ OOM, mã thoát 134);
  dùng `NODE_HEAP_MB` ghi đè được, đã cấu hình tường minh thì truyền thẳng.
- **CI (GitHub Actions)**：cài phụ thuộc → build contracts → baseline kiến trúc và route (`check-architecture`, gồm kiểm tra kết nối thẳng cổng AI) → mẫu môi trường →
  ảnh chụp OpenAPI → typecheck → **cổng cứng chuẩn code (`pnpm lint`, gồm prettier định dạng)** → kiểm thử đơn vị backend → kiểm thử thành phần frontend → kiểm chứng tải lên →
  **kho trống MySQL 8 chạy `prisma migrate deploy` (0001→0052)** → build frontend - backend.
- **Baseline thoát kiểu**：`pnpm audit:escapes` sinh `docs/escape-report.md` / `docs/escape-report.json`;
  `pnpm check:escape-budget` theo `.escape-budget.json` (tổng số và phân loại chỉ giảm không tăng) và `.escape-allowlist.json`
  (mục đăng ký số dòng trôi là thất bại) kiểm soát, CI đã nối vào (sau công cụ tự đo, trước các cổng khác).
- **Chuẩn xuống dòng**：`backend/.prettierrc` đặt `endOfLine: "auto"`, kiểm chứng theo xuống dòng hiện có của tệp; Windows lấy ra CRLF bằng
  `core.autocrlf=true`, chỉ mục kho và CI là LF, hai bên đều không báo nhầm. Các mụcđịnh dạng khác vẫn là quy tắc mặc định prettier.
- **Script tích hợp phụ thuộc cơ sở dữ liệu**：`pnpm test:regression` / `test:query-plans` / `test:performance` / `test:geo-recovery`
  hướng tới kho trống một lần PostgreSQL máy cục bộ (`createdb` + `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`),
  không tương thích phương ngữ MySQL mặc định, giữ làm chạy theo nhu cầu cục bộ.
- **Script smoke** (PowerShell, thuần ASCII, tên người dùng ngẫu nhiên đảm bảo lũy đẳng):

```powershell
pwsh scripts/smoke-m5.ps1   #khép kín board xã hội (quan hệ/dòng thời gian/nhóm/tin nhắn riêng/hồ sơ/kế thừachặn)
pwsh scripts/smoke-m6.ps1   # quảng trường cung cầu: đăng cục bộ miễn Key + chưa bind Key đồng bộ thượng nguồn 403
pwsh scripts/smoke-site-url.ps1            # chuẩn hóa tên miền site / CORS / phản chiếu công khai + trang 200
pwsh scripts/smoke-aipdd-platform-key.ps1  # Key AIPDD nền tảng: mật không rò rỉ + từ điển vùng dự phòng
```

---

## 🧹 Cắt bỏ tương đối bản thương mại thượng nguồn

Bản mã nguồn mở này là sản phẩm của「hợp nhất + khử nhạy cảm + bản địa hóa」, rõ ràng **không bao gồm**:

- Backend NestJS nguyên bản của SNS và thị giác xanh trắng aiworkin.com (kiến trúc thông tin giữ lại, style đều viết lại thành AntD);
- Nghiệp vụ liên quan tiền như thưởng / quyết toán awcoin (quảng trường cung cầu chỉ phản chiếu trạng thái thượng nguồn, không liên quan tiền; AWcoin của trung tâm điểm chỉ hiển thị chỉ đọc);
- Cơ chế nền tảng tra thay / xin thay Key `sk-`, `DEV_AUTO_LOGIN` cấp phát tại chỗ (dữ liệu demo do `prisma:seed` cung cấp,
  nhưng danh tính demo không đăng nhập được một chạm, phải đăng ký cục bộ bình thường);
- Dịch vụ danh mục Java thượng nguồn: nguồn dữ liệu đổi thành bảng `users` cục bộ.

---

## 💬 Cộng đồng

Tham gia nhóm thảo luận hệ thống dịch vụ doanh nghiệp AI, quét mã QR dưới đây là được. Hoan nghênh phát hiện vấn đề và đưa ra đề xuất cải tiến, góp ý tốt chúng tôi sẽ hiện thực và chia sẻ mã nguồn.

<div align="center">
<img src="docs/assets/wechat-group-qr.png" width="260" alt="Nhóm thảo luận hệ thống dịch vụ doanh nghiệp AI · mã QR WeChat">
</div>

---

## 📄 License

Released under the [Apache License 2.0](LICENSE).
