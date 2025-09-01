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
        site_name TEXT UNIQUE,
        schema_json TEXT NOT NULL,
        created_by INT REFERENCES users(id),
        db_url TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.commit(); conn.close()
init_form_defs()

# ========== 登录保护 ==========
def login_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return redirect(url_for("login_admin", next=request.path))
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


# ========== 超级管理员总览（表单 + 用户） ==========
# ========== 超级管理员总览（表单 + 用户） ==========
@app.route("/super_admin")
@admin_required
def super_admin():
    if session.get("role") != "super_admin":
        return "❌ 只有超级管理员能访问", 403

    conn = get_conn(); c = conn.cursor()

    # --------- 表单列表 ---------
    c.execute("SELECT id, name, site_name, db_url, created_by, created_at FROM form_defs ORDER BY id ASC")
    form_rows = c.fetchall()
    forms = [
        {
            "id": row[0],
            "name": row[1],
            "site_name": row[2],
            "db_url": row[3],
            "created_by": row[4],
            "created_at": row[5],
            "user_url": f"/site/{row[2]}/form",
            "admin_url": f"/site/{row[2]}/admin"
        }
        for row in form_rows
    ]

    # --------- 平台用户 ---------
    c.execute("SELECT id, username, role, '平台' as site_name, NOW() as created_at FROM users ORDER BY id ASC")
    users = list(c.fetchall())

    # --------- 各子网站用户 ---------
    for form in forms:
        schema_name = form["db_url"]  # 比如 form_test1
        try:
            c.execute(f"SET search_path TO {schema_name}")
            c.execute("SELECT id, username, role, %s as site_name, NOW() as created_at FROM users", (form["site_name"],))
            users += c.fetchall()
        except Exception as e:
            print(f"⚠️ 读取 {schema_name}.users 出错:", e)

    conn.close()

    return render_template("super_admin.html", forms=forms, users=users)



# ========== 超级管理员管理用户 ==========
@app.route("/super_admin/delete_user/<int:user_id>", methods=["POST"])
@admin_required
def super_admin_delete_user(user_id):
    if session.get("role") != "super_admin":
        return "❌ 无权限", 403
    try:
        conn = get_conn(); c = conn.cursor()

        # 1. 查出该用户创建的所有网站
        c.execute("SELECT site_name FROM form_defs WHERE created_by=%s", (user_id,))
        sites = [row[0] for row in c.fetchall()]

        # 2. 删除这些网站对应的 schema
        for site in sites:
            schema_name = f"form_{site}"
            c.execute(f"DROP SCHEMA IF EXISTS {schema_name} CASCADE")

        # 3. 删除 form_defs 记录
        c.execute("DELETE FROM form_defs WHERE created_by=%s", (user_id,))

        # 4. 删除用户
        c.execute("DELETE FROM users WHERE id=%s", (user_id,))

        conn.commit(); conn.close()
        return redirect(url_for("super_admin"))
    except Exception as e:
        import traceback
        traceback.print_exc()
        return f"<h2>❌ 删除用户失败: {e}</h2>", 500



@app.route("/super_admin/reset_password/<int:user_id>", methods=["POST"])
@admin_required
def super_admin_reset_password(user_id):
    if session.get("role") != "super_admin":
        return "❌ 无权限", 403

    site_name = request.form.get("site_name", "平台")
    conn = get_conn(); c = conn.cursor()
    new_pw = generate_password_hash("123456")  # 默认密码

    try:
        if site_name == "平台":
            # 重置平台用户密码
            c.execute("UPDATE users SET password_hash=%s WHERE id=%s", (new_pw, user_id))
        else:
            # 重置子网站用户密码
            schema_name = f"form_{site_name}"
            c.execute(f"SET search_path TO {schema_name}")
            c.execute("UPDATE users SET password_hash=%s WHERE id=%s", (new_pw, user_id))
        conn.commit()
    except Exception as e:
        conn.rollback()
        return f"❌ 重置密码失败: {e}", 500
    finally:
        conn.close()

    return redirect(url_for("super_admin"))


@app.route("/super_admin/delete/<site_name>", methods=["POST"])
@admin_required
def super_admin_delete(site_name):
    if session.get("role") != "super_admin":
        return "❌ 无权限", 403
    try:
        conn = get_conn(); c = conn.cursor()
        schema_name = f"form_{site_name}"
        c.execute(f"DROP SCHEMA IF EXISTS {schema_name} CASCADE")
        c.execute("DELETE FROM form_defs WHERE site_name=%s", (site_name,))
        conn.commit(); conn.close()
        return redirect(url_for("super_admin"))
    except Exception as e:
        traceback.print_exc()
        return f"<h2>❌ 删除失败: {e}</h2>", 500

# ========== 登出 ==========
@app.route("/logout/<site_name>")
def site_logout(site_name):
    session.pop(f"user_{site_name}", None)
    session.pop(f"role_{site_name}", None)
    return redirect(url_for("site_login", site_name=site_name))

@app.route("/logout_admin")
def logout_admin():
    session.clear()
    return redirect(url_for("login_admin"))

# ========== 首页 ==========
@app.route("/")
def index():
    return render_template("index.html")

# ========== 固定表单 ==========
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
        try:
            name = request.form.get("name")
            site_name = request.form.get("site_name")
            schema_json = request.form.get("schema_json")
            import re
            site_name = re.sub(r'[^a-z0-9_]', '_', site_name.lower())
            schema_name = f"form_{site_name}"

            conn = get_conn(); c = conn.cursor()
            c.execute(f"CREATE SCHEMA IF NOT EXISTS {schema_name}")
            c.execute(f"""
                CREATE TABLE IF NOT EXISTS {schema_name}.submissions (
                    id SERIAL PRIMARY KEY,
                    user_id INT,
                    data JSONB,
                    status TEXT DEFAULT '待审核',
                    review_comment TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            c.execute(f"""
                CREATE TABLE IF NOT EXISTS {schema_name}.users (
                    id SERIAL PRIMARY KEY,
                    username TEXT UNIQUE,
                    password_hash TEXT NOT NULL,
                    role TEXT DEFAULT 'user'
                )
            """)

            # 插入当前管理员账号到子站点
            c.execute("SELECT username, password_hash FROM users WHERE id=%s", (session.get("user_id"),))
            row = c.fetchone()
            if row:
                admin_username, admin_pw_hash = row
                try:
                    c.execute(f"""
                        INSERT INTO {schema_name}.users (id, username, password_hash, role)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING
                    """, (session.get("user_id"), admin_username, admin_pw_hash, "admin"))
                except Exception as e:
                    print("⚠️ 管理员账号已存在或插入失败:", e)

            c.execute(
                "INSERT INTO form_defs (name, site_name, schema_json, created_by, db_url) VALUES (%s,%s,%s,%s,%s)",
                (name, site_name, schema_json, session.get("user_id"), schema_name)
            )
            conn.commit(); conn.close()

            base_url = "https://school-practice-system.onrender.com"

            return f"""
            <h2>✅ 表单 <b>{name}</b> 已创建！</h2>
            <p>👉 普通用户入口：<br>
               <a href="{base_url}/site/{site_name}/form" target="_blank">
               {base_url}/site/{site_name}/form</a></p>
            <p>👉 管理员入口：<br>
               <a href="{base_url}/site/{site_name}/admin" target="_blank">
               {base_url}/site/{site_name}/admin</a></p>
            """
        except Exception as e:
            traceback.print_exc()
            return f"<h2>❌ 出错了: {e}</h2>", 500
    return render_template("create_form.html")

# ========== 动态表单 ==========
@app.route("/site/<site_name>/form", methods=["GET", "POST"])
def site_form(site_name):
    if not session.get(f"user_{site_name}"):
        return redirect(url_for("site_login", site_name=site_name))
    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT id, name, schema_json, db_url FROM form_defs WHERE site_name=%s", (site_name,))
    row = c.fetchone(); conn.close()
    if not row:
        return "❌ 表单不存在", 404
    form_id, form_name, schema_json, schema_name = row
    schema = json.loads(schema_json)
    if request.method == "POST":
        data = request.form.to_dict(flat=True)
        conn = get_conn(); c = conn.cursor()
        c.execute(f"SET search_path TO {schema_name}")
        c.execute("INSERT INTO submissions (user_id, data) VALUES (%s,%s)",
                  (session.get(f"user_{site_name}"), json.dumps(data)))
        conn.commit(); conn.close()
        return f"<h2>✅ 已提交到表单 {form_name}</h2><a href='/'>返回首页</a>"
    return render_template("dynamic_form.html", form_name=form_name, site_name=site_name, schema=schema)

# ========== 子网站用户管理 ==========
@app.route("/site/<site_name>/admin/users")
def site_admin_users(site_name):
    # ✅ 先检查是否登录了该子网站的管理员
    if not session.get(f"admin_{site_name}"):
        return redirect(url_for("site_admin_login", site_name=site_name))

    conn = get_conn(); c = conn.cursor()
    schema_name = f"form_{site_name}"
    c.execute(f"SET search_path TO {schema_name}")
    c.execute("SELECT id, username, role FROM users ORDER BY id ASC")
    users = c.fetchall()
    conn.close()

    return render_template("site_admin_users.html", site_name=site_name, users=users)


@app.route("/site/<site_name>/admin/delete_user/<int:user_id>", methods=["POST"])
def site_admin_delete_user(site_name, user_id):
    if not session.get(f"admin_{site_name}"):
        return redirect(url_for("site_admin_login", site_name=site_name))

    conn = get_conn(); c = conn.cursor()
    schema_name = f"form_{site_name}"
    try:
        c.execute(f"SET search_path TO {schema_name}")
        c.execute("DELETE FROM users WHERE id=%s", (user_id,))
        conn.commit()
    except Exception as e:
        conn.rollback()
        return f"❌ 删除失败: {e}", 500
    finally:
        conn.close()
    return redirect(url_for("site_admin_users", site_name=site_name))


@app.route("/site/<site_name>/admin/reset_password/<int:user_id>", methods=["POST"])
def site_admin_reset_password(site_name, user_id):
    if not session.get(f"admin_{site_name}"):
        return redirect(url_for("site_admin_login", site_name=site_name))

    new_pw = generate_password_hash("123456")  # 默认重置密码
    conn = get_conn(); c = conn.cursor()
    schema_name = f"form_{site_name}"
    try:
        c.execute(f"SET search_path TO {schema_name}")
        c.execute("UPDATE users SET password_hash=%s WHERE id=%s", (new_pw, user_id))
        conn.commit()
    except Exception as e:
        conn.rollback()
        return f"❌ 重置密码失败: {e}", 500
    finally:
        conn.close()
    return redirect(url_for("site_admin_users", site_name=site_name))

@app.route("/site/<site_name>/admin")
def site_admin(site_name):
    if not session.get(f"admin_{site_name}"):
        return redirect(url_for("site_admin_login", site_name=site_name))
    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT id, name, created_by, db_url FROM form_defs WHERE site_name=%s", (site_name,))
    row = c.fetchone(); conn.close()
    if not row:
        return "❌ 表单不存在", 404
    form_id, form_name, owner_id, schema_name = row
    conn = get_conn(); c = conn.cursor()
    c.execute(f"SET search_path TO {schema_name}")
    c.execute("SELECT id, user_id, data, status, review_comment, created_at FROM submissions ORDER BY id DESC")
    subs = c.fetchall(); conn.close()
    return render_template("dynamic_admin.html", form_name=form_name, submissions=subs, form_id=form_id)

# 子网站用户管理
@app.route("/site/<site_name>/admin/users")
def site_admin_users(site_name):
    if not session.get(f"admin_{site_name}"):
        return redirect(url_for("site_admin_login", site_name=site_name))

    conn = get_conn(); c = conn.cursor()
    c.execute(f"SET search_path TO form_{site_name}")
    c.execute("SELECT id, username, role FROM users ORDER BY id ASC")
    users = c.fetchall(); conn.close()

    return render_template("site_admin_users.html", site_name=site_name, users=users)


@app.route("/site/<site_name>/admin/delete_user/<int:user_id>", methods=["POST"])
def site_admin_delete_user(site_name, user_id):
    if not session.get(f"admin_{site_name}"):
        return redirect(url_for("site_admin_login", site_name=site_name))

    conn = get_conn(); c = conn.cursor()
    c.execute(f"SET search_path TO form_{site_name}")
    c.execute("DELETE FROM users WHERE id=%s", (user_id,))
    conn.commit(); conn.close()

    return redirect(url_for("site_admin_users", site_name=site_name))

# 用户注册
@app.route("/site/<site_name>/register", methods=["GET", "POST"])
def site_register(site_name):
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        conn = get_conn(); c = conn.cursor()
        c.execute(f"SET search_path TO form_{site_name}")
        try:
            c.execute("INSERT INTO users (username, password_hash, role) VALUES (%s,%s,%s)",
                      (username, generate_password_hash(password), "user"))
            conn.commit()
            msg = "✅ 注册成功，请去登录"
        except Exception:
            msg = "❌ 注册失败，用户名可能已存在"
        conn.close()
        return msg
    return render_template("site_register.html", site_name=site_name)

# 用户登录
@app.route("/site/<site_name>/login", methods=["GET", "POST"])
def site_login(site_name):
    error = None
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        conn = get_conn(); c = conn.cursor()
        c.execute(f"SET search_path TO form_{site_name}")
        c.execute("SELECT id, password_hash, role FROM users WHERE username=%s", (username,))
        row = c.fetchone(); conn.close()
        if row and check_password_hash(row[1], password):
            session[f"user_{site_name}"] = row[0]
            session[f"role_{site_name}"] = row[2]
            return redirect(url_for("site_form", site_name=site_name))
        else:
            error = "用户名或密码错误"
    return render_template("site_login.html", site_name=site_name, error=error)

@app.route("/site/<site_name>/admin_login", methods=["GET", "POST"])
def site_admin_login(site_name):
    error = None
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        conn = get_conn(); c = conn.cursor()
        c.execute("SELECT created_by FROM form_defs WHERE site_name=%s", (site_name,))
        row = c.fetchone(); conn.close()
        if not row:
            return "❌ 表单不存在", 404
        owner_id = row[0]
        conn = get_conn(); c = conn.cursor()
        c.execute(f"SET search_path TO form_{site_name}")
        c.execute("SELECT id, username, password_hash FROM users WHERE id=%s", (owner_id,))
        admin_row = c.fetchone(); conn.close()
        if admin_row and admin_row[1] == username and check_password_hash(admin_row[2], password):
            session[f"admin_{site_name}"] = admin_row[0]
            return redirect(url_for("site_admin", site_name=site_name))
        else:
            error = "用户名或密码错误"
    return render_template("site_admin_login.html", site_name=site_name, error=error)

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
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
