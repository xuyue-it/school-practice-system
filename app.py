from flask import Flask, render_template, request, redirect, url_for, send_file, jsonify, session
from docx import Document
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import Header
from email.utils import formataddr
import traceback
from dotenv import load_dotenv
load_dotenv()
import os
from functools import wraps
import psycopg2

app = Flask(__name__)

# ========== 基本配置 ==========
app.secret_key = os.getenv("SECRET_KEY", "replace-this-in-prod")

# 管理员密码（优先环境变量）
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "ahyork339188")
print(">>> ADMIN_PASSWORD source:", "ENV" if os.getenv("ADMIN_PASSWORD") else "DEFAULT")

# ========== 邮件配置 ==========
SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT   = int(os.getenv("SMTP_PORT", "587"))
SENDER_EMAIL    = os.getenv("SENDER_EMAIL", "lausukyork8@gmail.com")
SENDER_PASSWORD = os.getenv("SENDER_PASSWORD", "ejlnrpkvvwotxlzj")
ADMIN_EMAIL     = os.getenv("ADMIN_EMAIL", "lausukyork8@gmail.com")

# ========== 数据库配置（Neon PostgreSQL） ==========
DB_URL = os.getenv("DB_URL")
def get_conn():
    return psycopg2.connect(DB_URL, connect_timeout=10)

# ========== 器材清单 ==========
EQUIP_MAP = {
    "amp": "扩音器","pa": "音响系统","projector": "投影机","screen": "投影屏幕",
    "ext": "延长线","table": "桌子","chair": "椅子","podium": "讲台","hdmi": "HDMI线",
    "signal": "信号线"
}
# 麦克风单独处理（无线/有线）

# ===== 邮件发送 =====
def send_email(subject, content, to_email):
    msg = MIMEMultipart()
    msg['From'] = formataddr(("通用申请审核系统", SENDER_EMAIL))
    msg['To'] = to_email
    msg['Subject'] = Header(subject, "utf-8")
    msg.attach(MIMEText(content, "plain", "utf-8"))
    try:
        server = smtplib.SMTP_SSL(SMTP_SERVER, 465, timeout=20)
        server.login(SENDER_EMAIL, SENDER_PASSWORD)
        server.sendmail(SENDER_EMAIL, [to_email], msg.as_string())
        server.quit()
        print(f"✅ 邮件已发送至 {to_email}（SSL:465）")
        return True, None
    except Exception as e_ssl:
        print("⚠️ SSL(465) 发送失败：", e_ssl)
        print(traceback.format_exc())
    try:
        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT, timeout=20)
        server.ehlo(); server.starttls(); server.ehlo()
        server.login(SENDER_EMAIL, SENDER_PASSWORD)
        server.sendmail(SENDER_EMAIL, [to_email], msg.as_string())
        server.quit()
        print(f"✅ 邮件已发送至 {to_email}（TLS:587）")
        return True, None
    except Exception as e_tls:
        print("❌ 邮件发送失败（TLS:587）：", e_tls)
        print(traceback.format_exc())
        return False, str(e_tls)

# ========================
# 数据库初始化
# ========================
def init_db():
    conn = get_conn()
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS submissions (
        id SERIAL PRIMARY KEY,
        name TEXT, phone TEXT, email TEXT, group_name TEXT, event_name TEXT,
        start_date TEXT, start_time TEXT, end_date TEXT, end_time TEXT,
        location TEXT, event_type TEXT, participants TEXT, equipment TEXT,
        special_request TEXT, donation TEXT, donation_method TEXT,
        remarks TEXT, emergency_name TEXT, emergency_phone TEXT,
        status TEXT DEFAULT '待审核', review_comment TEXT
    )''')
    conn.commit(); conn.close()

init_db()

# ========================
# 登录保护
# ========================
def login_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if not session.get("logged_in"):
            return redirect(url_for("login", next=request.path))
        return view_func(*args, **kwargs)
    return wrapper

@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        if request.form.get("password", "") == ADMIN_PASSWORD:
            session["logged_in"] = True
            return redirect(request.args.get("next") or url_for("admin"))
        error = "密码错误，请重试。"
    return render_template("login.html", error=error)

@app.route("/logout")
def logout():
    session.pop("logged_in", None)
    return redirect(url_for("login"))

# ========================
# 前台
# ========================
@app.route("/")
def index():
    return render_template("index.html", equip_map=EQUIP_MAP)

@app.route("/submit", methods=["POST"])
def submit():
    data = request.form.to_dict(flat=True)
    equip_items = []

    # ✅ 特殊处理：无线麦克风
    if data.get("equip_mic_wireless") == "on":
        qty = int(data.get("equip_mic_wireless_qty") or 1)
        equip_items.append(f"无线麦克风x{qty}")

    # ✅ 特殊处理：有线麦克风
    if data.get("equip_mic_wired") == "on":
        qty = int(data.get("equip_mic_wired_qty") or 1)
        equip_items.append(f"有线麦克风x{qty}")

    # ✅ 其他器材
    for key, cname in EQUIP_MAP.items():
        if data.get(f"equip_{key}") == "on":
            qty_str = (data.get(f"equip_{key}_qty") or "").strip()
            try: qty = int(qty_str)
            except: qty = 0
            if qty <= 0: qty = 1
            equip_items.append(f"{cname}x{qty}")

    equipment_str = ", ".join(equip_items)

    conn = get_conn(); c = conn.cursor()
    c.execute('''
        INSERT INTO submissions (
            name, phone, email, group_name, event_name,
            start_date, start_time, end_date, end_time,
            location, event_type, participants, equipment,
            special_request, donation, donation_method,
            remarks, emergency_name, emergency_phone
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    ''', (
        data.get('name'), data.get('phone'), data.get('email'), data.get('group'),
        data.get('event_name'), data.get('start_date'), data.get('start_time'),
        data.get('end_date'), data.get('end_time'), data.get('location'),
        data.get('event_type'), data.get('participants'), equipment_str,
        data.get('special_request'), data.get('donation'), data.get('donation_method'),
        data.get('remarks'), data.get('emergency_name'), data.get('emergency_phone')
    ))
    conn.commit(); conn.close()

    send_email("【新申请】通用申请",
               f"申请人：{data.get('name')}\n活动：{data.get('event_name')}\n电话：{data.get('phone')}\n邮箱：{data.get('email')}",
               ADMIN_EMAIL)

    return """<html><body><h1>提交成功！</h1><p>请返回首页查询审核状态。</p></body></html>"""

# ========================
# 管理页 + 接口
# ========================
@app.route("/admin")
@login_required
def admin():
    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT * FROM submissions ORDER BY id DESC")
    submissions = c.fetchall()
    conn.close()
    return render_template("admin.html", submissions=submissions)

@app.route("/api/submission/<int:submission_id>")
@login_required
def api_submission(submission_id):
    conn = get_conn(); c = conn.cursor()
    c.execute("""SELECT id, name, email, event_name, status, review_comment
                 FROM submissions WHERE id=%s""", (submission_id,))
    row = c.fetchone(); conn.close()
    if not row:
        return jsonify({"success": False, "message": "记录不存在"}), 404
    return jsonify({"success": True,"data": {
        "id": row[0], "name": row[1], "email": row[2], "event_name": row[3],
        "status": row[4] or "待审核", "review_comment": row[5] or ""
    }})

@app.route("/update_status/<int:submission_id>/<string:new_status>", methods=["POST"])
@login_required
def update_status(submission_id, new_status):
    try:
        data = request.get_json(silent=True) or {}
        comment = data.get("comment", "")

        conn = get_conn(); c = conn.cursor()
        c.execute("UPDATE submissions SET status=%s, review_comment=%s WHERE id=%s",
                  (new_status, comment, submission_id))
        conn.commit()

        c.execute("SELECT name, email, status FROM submissions WHERE id=%s", (submission_id,))
        row = c.fetchone()
        conn.close()

        if row and row[1]:
            try:
                send_email("【审核结果】通用申请审核系统",
                           f"您好 {row[0]}，您的申请已被审核为：{row[2]}\n审核说明：{comment or '无'}",
                           row[1])
            except Exception as mail_err:
                print("⚠️ 审核后通知申请人失败：", mail_err)

        return jsonify({"success": True, "submission_id": submission_id,
                        "name": row[0] if row else "", "status": row[2] if row else new_status})
    except Exception as e:
        print("❌ /update_status 出错：", e); print(traceback.format_exc())
        return jsonify({"success": False, "message": f"服务器错误：{e}"}), 500

@app.route("/send_review_email/<int:submission_id>", methods=["POST"])
@login_required
def send_review_email(submission_id):
    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT name, email, event_name, status, review_comment FROM submissions WHERE id=%s",
              (submission_id,))
    row = c.fetchone(); conn.close()
    if not row: return jsonify({"success": False, "message": "记录不存在"}), 404

    name, email, event_name, status, review_comment = row
    if not email: return jsonify({"success": False, "message": "该记录没有填写邮箱，无法发送"}), 400

    ok, err = send_email(f"【审核结果】{event_name or ''}",
                         f"您好 {name or ''}：\n\n您的申请（活动：{event_name or '-'}) "
                         f"审核结果为：{status or '待审核'}\n审核说明：{review_comment or '无'}\n\n"
                         f"如有疑问请回复此邮件联系管理员。",
                         email)
    if ok: return jsonify({"success": True, "message": f"已发送到 {email}"})
    else:  return jsonify({"success": False, "message": f"发送失败：{err}"}), 500

@app.route("/delete_submission/<int:submission_id>", methods=["POST"])
@login_required
def delete_submission(submission_id):
    conn = get_conn(); c = conn.cursor()
    c.execute("DELETE FROM submissions WHERE id=%s", (submission_id,))
    affected = c.rowcount
    conn.commit(); conn.close()
    return jsonify({"success": True, "submission_id": submission_id, "deleted": affected})

@app.route("/download/<int:submission_id>")
@login_required
def download(submission_id):
    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT * FROM submissions WHERE id=%s", (submission_id,))
    submission = c.fetchone(); conn.close()
    if not submission: return "记录不存在"

    doc = Document(); doc.add_heading('申请表详情', level=1)
    fields = ["ID","姓名","电话","邮箱","团体名称","活动名称","开始日期","开始时间",
              "结束日期","结束时间","地点","活动类型","参与人数","器材","特别需求",
              "捐款","捐款方式","备注","紧急联系人","紧急联系电话","审核状态","审核说明"]
    for i, field in enumerate(fields):
        if i < len(submission):
            doc.add_paragraph(f"{field}: {submission[i]}")

    file_path = f"submission_{submission_id}.docx"; doc.save(file_path)
    return send_file(file_path, as_attachment=True)

# ========================
# 查询状态 API
# ========================
@app.route("/check_status_api")
def check_status_api():
    name = request.args.get("name")
    if not name:
        return jsonify({"status": "error", "message": "Name is required"})

    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT name, event_name, status, review_comment FROM submissions WHERE name=%s ORDER BY id DESC LIMIT 1", (name,))
    row = c.fetchone(); conn.close()

    if row:
        return jsonify({
            "status": row[2],
            "data": {
                "name": row[0],
                "event_name": row[1],
                "review_status": row[2],
                "review_comment": row[3] or ""
            }
        })
    else:
        return jsonify({"status": "not_found"})

@app.route("/_health")
def _health(): return "ok", 200

if __name__ == "__main__":
    app.run(debug=True)
