# Giọng Việt cho Codex

Extension riêng cho VS Code desktop: tự đọc phản hồi Codex bằng **Hoài Mỹ**,
chỉnh tốc độ, cao độ và âm lượng ngay trong IDE. Viết mới, mã nguồn MIT;
không phải bản sửa đổi của Audio for Codex và không phải sản phẩm OpenAI.

## Cài trên máy khác

1. Chép file **`codex-hoaimy-0.1.0.vsix`** sang máy cần dùng.
2. Trong VS Code, mở Extensions bằng `Ctrl+Shift+X` (macOS: `Cmd+Shift+X`).
3. Bấm menu `…` → **Install from VSIX…** → chọn file `.vsix`.
4. Reload Window nếu IDE yêu cầu. Mở Command Palette và chạy
   **Giọng Việt: Mở bảng điều khiển**.
5. Bấm **Nghe thử**. Đăng nhập Codex trong IDE rồi gửi một tin nhắn mới.
   Bật **Tự đọc phản hồi** để nghe các câu trả lời tiếp theo.

Có thể cài bằng CLI:

```bash
code --install-extension codex-hoaimy-0.1.0.vsix
```

Không cần cài Python, Node.js, eSpeak, FFmpeg hoặc API key trên máy sử dụng:
phần tạo giọng được đóng gói sẵn; MP3 phát trực tiếp trong webview của IDE.
Cần VS Code desktop 1.85 trở lên, kết nối Internet và Codex có ghi session
log trên cùng máy. Không hỗ trợ VS Code chạy hoàn toàn trong trình duyệt.

Với Antigravity: nếu phiên bản đang dùng cho phép **Install from VSIX…**,
dùng cùng gói cài. Bản này đã được kiểm tra thực tế trên VS Code/Linux;
chưa chạy thử trên Windows, macOS hay Antigravity. Không có thư viện native
hoặc lệnh hệ điều hành trong luồng tạo giọng/phát âm thanh.

## Điều khiển trong IDE

Bấm **Giọng Việt** trên thanh trạng thái để mở bảng điều khiển. Có thể đóng
sang tab khác khi đọc; bảng được giữ trong bộ nhớ. Đóng hẳn bảng sẽ dừng đoạn
đang đọc; phản hồi mới tiếp theo có thể mở bảng lại.

| Thuộc tính | Tùy chỉnh |
| --- | --- |
| Giọng | Hoài Mỹ (nữ), Nam Minh (nam), Emma (nữ đa ngôn ngữ) |
| Tốc độ | −50% đến +100%; mặc định −5% |
| Cao độ | −50 Hz đến +50 Hz; mặc định 0 Hz |
| Âm lượng | 0–100%, thay đổi ngay cả khi đang đọc |
| Tự đọc | Bật/tắt phản hồi mới; tắt sẽ dừng đoạn đang đọc |
| Phạm vi | Thư mục làm việc hiện tại (mặc định), hoặc tất cả phiên chính |
| Khối mã | Bỏ qua hoặc đọc cả phần mã |
| Giọng dự phòng | Emma khi giọng chính lỗi; có thể tắt |
| Thử lại | 0–5 lần sau lần gọi đầu tiên |
| Đường dẫn sessions | Tự nhận diện hoặc chọn thư mục khác |
| Proxy | HTTP(S) proxy tùy chọn trong VS Code Settings |

Tốc độ/cao độ áp dụng từ đoạn đọc tiếp theo; bấm **Dừng** rồi **Đọc lại**
nếu muốn áp dụng từ đầu. Các thiết lập lưu trong VS Code User Settings,
không ghi vào dự án. Dịch vụ Edge có thể giới hạn mức thay đổi tùy giọng.

Phản hồi dài được chia thành các đoạn tối đa khoảng 1.000 ký tự. Trong lúc
phát một đoạn, extension tạo sẵn giọng cho đoạn kế tiếp để giảm khoảng chờ.
Chỉ chuẩn bị trước một đoạn để hạn chế RAM; mạng chậm vẫn có thể gây ngắt.
Nếu đổi tốc độ, cao độ hoặc giọng, đoạn đã chuẩn bị vẫn dùng thiết lập cũ;
bấm **Dừng** rồi **Đọc lại** để áp dụng ngay. Nút **Dừng** hủy cả đoạn đang
phát và đoạn đang tạo.

Giọng đọc tự bỏ qua tên file thông dụng và đường dẫn, kể cả trong inline code
hoặc nhãn liên kết. Phần chữ hiển thị vẫn giữ nguyên; tên lệnh như **Reload
Window** vẫn được đọc.

Nút **Tạm dừng / Tiếp tục**, **Dừng**, **Đọc lại**, **Nghe thử** đều nằm trên
bảng điều khiển. Có ô dán văn bản để đọc tùy ý và mục **Đọc văn bản đang
chọn** trong menu chuột phải của editor. Các lệnh đều bắt đầu bằng
**Giọng Việt:** trong Command Palette.

## Tránh phát hai giọng trên máy hiện tại

Nếu vẫn cài Audio for Codex, tắt phần tự đọc của extension đó. Bộ Giọng Việt
này hoạt động độc lập và không sửa cài đặt của extension khác.

Nếu đã cài bộ đọc nền Linux trong lần thiết lập trước, dừng và tắt tự khởi
động của nó trước khi dùng extension mới:

```bash
systemctl --user disable --now codex-vietnamese-tts.service
```

Trên máy khác không có bộ đọc nền đó thì bỏ qua bước này. Không cần cài
Audio for Codex để sử dụng Giọng Việt.

## Kết nối với Codex

Theo dõi file `~/.codex/sessions/**/*.jsonl`, hoặc `$CODEX_HOME/sessions` khi
biến này được đặt. Đọc sự kiện `task_complete`, chỉ lấy câu trả lời cuối
cùng. Bỏ qua lịch sử cũ lúc khởi động, lời cập nhật tiến độ, prompt, tool
output và phiên subagent. Giữ dấu vân tay của turn để tránh đọc trùng khi
mở nhiều cửa sổ VS Code. Không cần sửa hooks hoặc cấu hình đăng nhập Codex.

Mặc định chỉ đọc phiên có `cwd` nằm trong workspace hiện tại; nếu mở IDE
không có thư mục hoặc muốn nghe Codex CLI ở mọi thư mục, đổi **Phạm vi tự
đọc** thành **Tất cả phiên Codex chính trên máy**.

Extension chạy ở máy giao diện khi dùng Remote SSH/Containers. Session log
chỉ có trên máy remote sẽ không tự xuất hiện ở máy local: cần cung cấp một
thư mục sessions có thể truy cập trên máy local. Bản này không đồng bộ log
qua SSH và không hỗ trợ giả lập microphone.

## Riêng tư và giới hạn

- Chỉ phần văn bản cần đọc được gửi tới dịch vụ đọc của Microsoft. Dùng
  công cụ `node-edge-tts`; không có tài khoản hay khóa API riêng.
- Không có telemetry. Không gửi prompt, tool output, toàn bộ session log
  hay thông tin đăng nhập Codex.
- Nội dung phản hồi và MP3 chỉ giữ trong bộ nhớ phiên IDE; dấu chống đọc
  trùng chỉ chứa hash và thời điểm, tự dọn sau bảy ngày.
- Cần Internet. Dịch vụ Microsoft có thể chậm, giới hạn hoặc thay đổi giao
  thức. Có thử lại, nút đọc lại và giọng dự phòng. Không cam kết dịch vụ
  luôn có sẵn hay không có giới hạn.
- Nếu IDE chặn tự phát âm thanh lần đầu, bấm **Tiếp tục** trong bảng.
- Tương thích phụ thuộc định dạng session log Codex hiện tại. Nếu Codex đổi
  định dạng log, extension có thể cần cập nhật.

## Xây dựng từ mã nguồn

Cần Node.js 22 trở lên trên máy phát triển, không cần trên máy chỉ cài VSIX.

```bash
npm ci
npm test
npm run build
npm run package
```

Kết quả ở `releases/codex-hoaimy-0.1.0.vsix`. Gói chứa engine JavaScript,
giao diện và thông báo giấy phép thư viện, không chứa `node_modules` hay
phụ thuộc native. Để chạy kiểm tra giao diện trong VS Code/Linux:

```bash
npm run test:host
```

Test mở một cửa sổ/profile riêng, dùng session giả lập, kiểm tra điều khiển
và phát âm thanh thực (cần Internet/loa). Có thể đặt `VSCODE_EXECUTABLE`
thành đường dẫn executable Electron của VS Code nếu khác
`/usr/share/code/code`. Test không đổi thiết lập IDE đang sử dụng.

## Gỡ cài đặt

Gỡ **Giọng Việt cho Codex** trong Extensions. Bộ đọc dừng cùng extension;
không cài dịch vụ nền. Nếu muốn dùng lại bộ đọc nền Linux cũ:

```bash
systemctl --user enable --now codex-vietnamese-tts.service
```

Tài liệu kỹ thuật tham khảo:
[VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview),
[đóng gói VSIX](https://code.visualstudio.com/api/working-with-extensions/publishing-extension),
[node-edge-tts](https://github.com/SchneeHertz/node-edge-tts),
[edge-tts](https://github.com/rany2/edge-tts).
