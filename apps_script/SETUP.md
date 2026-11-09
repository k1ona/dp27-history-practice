# Setting up the class drive connection

This connects the practice app to your Google Drive. Students' answers arrive in a Drive folder and a Google Sheet (the Register), and feedback you place in Drive goes back to them. You do this once. It takes about 15 minutes.

You need: your school Google account, and the two files in this folder, `Code.gs` and `appsscript.json`.

---

## Part A: make the script

1. **Make a folder in Google Drive** to hold everything, for example `DP History app`.
   Open it. Look at the address bar: the address ends with `/folders/` followed by a long code. **Copy that code**, which is the folder ID.

2. Go to **https://script.google.com** and click **New project**.
   Click the title "Untitled project" at the top and name it **DP27 Practice**.

3. You will see a file called **Code.gs** with a few lines in it.
   - Delete everything in it.
   - Open `Code.gs` from this folder, copy all of it, and paste it in.
   - Near the top, find the line `var PARENT_FOLDER_ID = '';` and paste your folder ID between the two quote marks, like this:
     `var PARENT_FOLDER_ID = '1AbCdEfG...';`
   - Press **⌘S** (Mac) or **Ctrl+S** (Windows) to save.

4. Click the **gear icon (Project Settings)** on the left. Tick **Show "appsscript.json" manifest file in editor**.
   Go back to the **Editor** (the `< >` icon). A new file `appsscript.json` appears. Open it, delete everything, paste in the contents of `appsscript.json` from this folder, and save.

## Part B: run the set-up once

5. At the top of the editor there is a drop-down list of functions. Choose **setup**, then click **Run**.

6. Google asks for permission:
   - Click **Review permissions** and choose your account.
   - You will see "Google hasn't verified this app". This is normal for a script you wrote yourself. Click **Advanced**, then **Go to DP27 Practice (unsafe)**.
   - Click **Allow**.

7. When it finishes, the **Execution log** at the bottom lists the new folder and sheet IDs.
   In your Drive folder you now have **DP27 Practice**, containing:
   - **Submissions** (students' answers arrive here)
   - **Feedback** (you put feedback files here)
   - **Backups** (each student's saved work)
   - **DP27 Practice Register** (the Google Sheet)

## Part C: add your students

8. Open **DP27 Practice Register**. On the **Students** tab, fill one row per student:

   | studentId | name | level | pinHash | active | newPin |
   |---|---|---|---|---|---|
   | S01 | (student's name) | HL | (leave empty) | TRUE | (a 4–8 digit PIN) |

   Also add a test student for checking everything works:

   | S99 | Test Student | HL | | TRUE | 4821 |

   Names stay in your private Sheet only. They are never in the app or on the website.

9. Back in the script editor, choose **hashNewPins** in the function list and click **Run**.
   In the Sheet, the PINs disappear from **newPin**, and a long code appears in **pinHash**. PINs are stored only as these codes.
   (The script also does this every hour, so later PIN changes are picked up automatically.)

## Part D: put it online

10. In the script editor click **Deploy** (top right) → **New deployment**.
    - Click the gear next to "Select type" and choose **Web app**.
    - Description: `DP27 sync`
    - **Execute as: Me**
    - **Who has access: Anyone**
    - Click **Deploy**, then **Authorize access** if asked (same steps as in step 6).

11. Copy the **Web app URL**. It starts with `https://script.google.com/macros/s/` and ends with `/exec`.
    **Send this address to the person maintaining the app.** It goes into the app's `config.json`. It is safe to publish, because every request needs a student's PIN.

That's all.

---

## Day to day

- **Students sign in** with the class code (**12A**), their student ID and PIN, once per device while online.
- **Answers** arrive in **Submissions** (one `.json` file each) and as one row each on the **Submissions** tab, with `feedbackStatus` = `pending`.
- **Feedback:** put a file named `<submissionId>.feedback.json` in the **Feedback** folder (format in `docs/DATA_CONTRACT.md`). Within an hour it is read into the **Feedback** tab and released to the student, who sees it on their next sync. To release it at once, run **ingestFeedback** in the editor.
- **Holding feedback back:** before the file is read in, change that submission's `feedbackStatus` to `hold` on the **Submissions** tab. To release it later, change it to `ready`.
- **Predicted grades** are on the **Predicted** tab, for you only. They are rebuilt every hour from the marks in feedback files: full essays, Paper 1 questions and timed papers only, with at least 2 marks per paper. Type each student's IA mark (out of 25) in the IA column; it is kept when the tab is rebuilt. Weights and grade boundaries are on the **Settings** tab. The defaults are placeholders: check them against the legacy guide and replace the boundaries with the session's.
- **A student forgets their PIN:** type a new PIN in their **newPin** cell. It is hashed within the hour (or run **hashNewPins**). Their old sign-in on any device stops working, and they sign in again with the new PIN.
- **Ten wrong PINs** within an hour lock that student ID for an hour.

## Automatic feedback (optional)

An extra file can be added to the script project to write feedback on new answers automatically every hour. Follow the separate instructions you were given for it. When it is on, the **autoFeedback** column of the Submissions tab shows its progress, and the Feedback tab's **source** column says whether each piece of feedback was written automatically or by you.

## Changing the script later

Edit the code, save, then **Deploy → Manage deployments → ✏️ (edit) → Version: New version → Deploy**. The web app address stays the same. (A *new deployment* would create a different address.)

## What the script can and cannot see

It runs as you, so it can reach your Drive. It only ever touches the **DP27 Practice** folder it created and the Register sheet. Do not share the Register sheet with students: it holds names and predicted grades.
