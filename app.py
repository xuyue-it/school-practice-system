from flask import Flask, render_template, request, redirect, url_for, send_file, jsonify, session
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
from docx import Document
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import Header
from email.utils import formataddr
import traceback
from dotenv import load_dotenv
import os
from functools import wraps
import psycopg2
import json

# ========== Flask 应用 ==========
app = Flask(__name__)

# 上传文件目录
UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024  # 5MB

ALLOWED_EXTENSIONS = {"pdf", "doc", "docx", "jpg", "jpeg", "png"}
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# ========== 基本配置 ==========
load_dotenv()
app.secret_key = os.getenv("SECRET_KEY", "replace-this-in-prod")

# 邮件配置
SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SENDER_EMAIL = os.getenv("SENDER_EMAIL", "lausukyork8@gmail.com")
SENDER_PASSWORD = os.getenv("SENDER_PASSWORD", "ejlnrpkvvwotxlzj")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "lausukyork8@gmail.com")

# 数据库配置（主库）
DB_URL = os.getenv("DB_URL")
def get_conn():
    return psycopg2.connect(DB_URL, connect_timeout=10)

# ========== 用户表初始化 ==========
def init_user_table():
    conn = get_conn(); c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE,
        password_hash TEXT,
        role TEXT DEFAULT 'user'
    )''')
    conn.commit(); conn.close()
init_user_table()

# ========= 原有 submissions 表（固定表单） =========
def init_main_submissions():
    conn = get_conn(); c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS submissions (
        id SERIAL PRIMARY KEY,
        name TEXT,
        phone TEXT,
        email TEXT,
        group_name TEXT,
        event_name TEXT,
        start_date TEXT,
        start_time TEXT,
        end_date TEXT,
        end_time TEXT,
        location TEXT,
        event_type TEXT,
        participants TEXT,
        equipment TEXT,
        special_request TEXT,
        donation TEXT,
        donation_method TEXT,
        remarks TEXT,
        emergency_name TEXT,
        emergency_phone TEXT,
        attachment TEXT,
        status TEXT DEFAULT '待审核',
        review_comment TEXT
    )''')
    conn.commit(); conn.close()
init_main_submissions()

# ========= 动态表单定义表 =========
def init_form_defs():
    conn = get_conn(); c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS form_defs (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        site_name TEXT UNIQUE,         -- 网站名，唯一
        schema_json TEXT NOT NULL,
        created_by INT REFERENCES users(id),
        db_url TEXT NOT NULL,          -- 独立数据库
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.commit(); conn.close()
init_form_defs()

# ========== 登录保护 ==========
def login_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return redirect(url_for("login_user", next=request.path))
        return view_func(*args, **kwargs)
    return wrapper

def admin_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return redirect(url_for("login_admin", next=request.path))
        if session.get("role") not in ["admin", "super_admin"]:
            return "无权限访问", 403
        return view_func(*args, **kwargs)
    return wrapper

# ========== 平台入口：管理员注册/登录 ==========
@app.route("/register_admin", methods=["GET", "POST"])
def register_admin():
    error = None
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        try:
            conn = get_conn(); c = conn.cursor()
            c.execute("INSERT INTO users (username, password_hash, role) VALUES (%s,%s,%s)",
                      (username, generate_password_hash(password), "admin"))
            conn.commit(); conn.close()
            return redirect(url_for("login_admin"))
        except Exception:
            error = "注册失败，可能用户名已存在"
    return render_template("register_admin.html", error=error)

@app.route("/login_admin", methods=["GET", "POST"])
def login_admin():
    error = None
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        conn = get_conn(); c = conn.cursor()
        c.execute("SELECT id, password_hash, role FROM users WHERE username=%s", (username,))
        row = c.fetchone(); conn.close()
        if row and check_password_hash(row[1], password) and row[2] in ["admin", "super_admin"]:
            session["user_id"] = row[0]
            session["username"] = username
            session["role"] = row[2]
            if row[2] == "super_admin":
                return redirect(url_for("super_admin"))
            else:
                return redirect(url_for("dashboard"))
        else:
            error = "用户名或密码错误"
    return render_template("login_admin.html", error=error)

@app.route("/dashboard")
@admin_required
def dashboard():
    return render_template("dashboard.html")

# ========== 超级管理员总览 ==========
@app.route("/super_admin")
@admin_required
def super_admin():
    if session.get("role") != "super_admin":
        return "❌ 只有超级管理员能访问", 403
    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT id, name, site_name, db_url FROM form_defs ORDER BY id ASC")
    forms = c.fetchall()
    conn.close()
    return render_template("super_admin.html", forms=forms)

# ========== 普通用户注册/登录 ==========
@app.route("/register_user", methods=["GET", "POST"])
def register_user():
    error = None
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        try:
            conn = get_conn(); c = conn.cursor()
            c.execute("INSERT INTO users (username, password_hash, role) VALUES (%s,%s,%s)",
                      (username, generate_password_hash(password), "user"))
            conn.commit(); conn.close()
            return redirect(url_for("login_user"))
        except Exception:
            error = "注册失败，可能用户名已存在"
    return render_template("register_user.html", error=error)

@app.route("/login_user", methods=["GET", "POST"])
def login_user():
    error = None
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        conn = get_conn(); c = conn.cursor()
        c.execute("SELECT id, password_hash, role FROM users WHERE username=%s", (username,))
        row = c.fetchone(); conn.close()
        if row and check_password_hash(row[1], password) and row[2] == "user":
            session["user_id"] = row[0]
            session["username"] = username
            session["role"] = row[2]
            return redirect(url_for("index"))
        else:
            error = "用户名或密码错误"
    return render_template("login_user.html", error=error)

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))

# ========== 首页 ==========
@app.route("/")
def index():
    return render_template("index.html")

# ========== 固定表单（原本的） ==========
@app.route("/form")
@login_required
def form():
    return render_template("form.html")

@app.route("/submit", methods=["POST"])
@login_required
def submit():
    data = request.form.to_dict(flat=True)
    files = request.files.getlist("attachments")
    filenames = []
    for file in files:
        if file and file.filename and allowed_file(file.filename):
            fname = secure_filename(file.filename)
            save_path = os.path.join(app.config["UPLOAD_FOLDER"], fname)
            file.save(save_path)
            filenames.append(fname)
    filenames_str = ",".join(filenames) if filenames else None

    equipment_str = ", ".join(request.form.getlist("equipment"))

    conn = get_conn(); c = conn.cursor()
    c.execute('''INSERT INTO submissions (
        name, phone, email, group_name, event_name,
        start_date, start_time, end_date, end_time,
        location, event_type, participants, equipment,
        special_request, donation, donation_method,
        remarks, emergency_name, emergency_phone, attachment
    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
              %s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
        (data.get('name'), data.get('phone'), data.get('email'), data.get('group'),
         data.get('event_name'), data.get('start_date'), data.get('start_time'),
         data.get('end_date'), data.get('end_time'), data.get('location'),
         data.get('event_type'), data.get('participants'), equipment_str,
         data.get('special_request'), data.get('donation'), data.get('donation_method'),
         data.get('remarks'), data.get('emergency_name'), data.get('emergency_phone'),
         filenames_str))
    conn.commit(); conn.close()

    send_email("【新申请】通用申请", f"申请人：{data.get('name')} 活动：{data.get('event_name')}", ADMIN_EMAIL)
    return "<h1>提交成功！</h1><p>请返回首页查询审核状态。</p>"

# ========== 查询状态 ==========
@app.route("/status")
@login_required
def status():
    return render_template("status.html")

@app.route("/check_status_api")
@login_required
def check_status_api():
    name = request.args.get("name")
    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT name, event_name, status, review_comment FROM submissions WHERE name=%s ORDER BY id DESC LIMIT 1", (name,))
    row = c.fetchone(); conn.close()
    if row:
        return jsonify({"status": row[2], "data": {
            "name": row[0], "event_name": row[1],
            "review_status": row[2], "review_comment": row[3] or ""}})
    else:
        return jsonify({"status": "not_found"})

# ========== 创建动态表单 ==========
@app.route("/create_form", methods=["GET", "POST"])
@admin_required
def create_form():
    if request.method == "POST":
        name = request.form.get("name")
        site_name = request.form.get("site_name")
        schema_json = request.form.get("schema_json")
        db_url = request.form.get("db_url")

        conn = get_conn(); c = conn.cursor()
        c.execute("INSERT INTO form_defs (name, site_name, schema_json, created_by, db_url) VALUES (%s,%s,%s,%s,%s)",
                  (name, site_name, schema_json, session.get("user_id"), db_url))
        conn.commit(); conn.close()
        return f"<h2>✅ 表单 <b>{name}</b> 已创建！</h2><p>访问地址：<b>/site/{site_name}/form</b></p>"
    return render_template("create_form.html")

# ========== 动态表单 - 填写 ==========
@app.route("/site/<site_name>/form", methods=["GET", "POST"])
@login_required
def site_form(site_name):
    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT id, name, schema_json, db_url FROM form_defs WHERE site_name=%s", (site_name,))
    row = c.fetchone(); conn.close()
    if not row: return "❌ 表单不存在", 404
    form_id, form_name, schema_json, db_url = row
    schema = json.loads(schema_json)

    if request.method == "POST":
        data = request.form.to_dict(flat=True)
        dconn = psycopg2.connect(db_url, connect_timeout=10); dc = dconn.cursor()
        dc.execute('''CREATE TABLE IF NOT EXISTS submissions (
            id SERIAL PRIMARY KEY,
            user_id INT,
            data JSONB,
            status TEXT DEFAULT '待审核',
            review_comment TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )''')
        dc.execute("INSERT INTO submissions (user_id, data) VALUES (%s,%s)",
                   (session.get("user_id"), json.dumps(data)))
        dconn.commit(); dconn.close()
        return f"<h2>✅ 已提交到表单 {form_name}</h2><a href='/'>返回首页</a>"

    return render_template("dynamic_form.html", form_name=form_name, schema=schema, form_id=form_id)

# ========== 动态表单 - 管理后台 ==========
@app.route("/site/<site_name>/admin")
@admin_required
def site_admin(site_name):
    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT id, name, created_by, db_url FROM form_defs WHERE site_name=%s", (site_name,))
    row = c.fetchone(); conn.close()
    if not row: return "❌ 表单不存在", 404
    form_id, form_name, owner_id, db_url = row
    if owner_id != session.get("user_id"):
        return "❌ 无权限", 403

    dconn = psycopg2.connect(db_url, connect_timeout=10); dc = dconn.cursor()
    dc.execute("SELECT id, user_id, data, status, review_comment, created_at FROM submissions ORDER BY id DESC")
    subs = dc.fetchall(); dconn.close()
    return render_template("dynamic_admin.html", form_name=form_name, submissions=subs, form_id=form_id)

# ========== 用户管理 ==========
@app.route("/users")
@admin_required
def users():
    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT id, username, role FROM users ORDER BY id ASC")
    users = c.fetchall()
    conn.close()
    return render_template("users.html", users=users)

# ========== 邮件发送 ==========
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
        return True, None
    except Exception as e_ssl:
        print("SSL失败:", e_ssl)
    try:
        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT, timeout=20)
        server.starttls()
        server.login(SENDER_EMAIL, SENDER_PASSWORD)
        server.sendmail(SENDER_EMAIL, [to_email], msg.as_string())
        server.quit()
        return True, None
    except Exception as e_tls:
        print("TLS失败:", e_tls)
        return False, str(e_tls)

# ========== 健康检查 ==========
@app.route("/_health")
def _health():
    return "ok", 200

# 启动
if __name__ == "__main__":
    app.run(debug=True)
