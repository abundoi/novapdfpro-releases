using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("NovaPDFPro Uninstaller")]
[assembly: AssemblyProduct("NovaPDFPro")]
[assembly: AssemblyCompany("NovaPDFPro")]
[assembly: AssemblyVersion("1.31.0.0")]
[assembly: AssemblyFileVersion("1.31.0.0")]

namespace NovaPDFProSetup
{
    internal static class UninstallNativeShell
    {
        [DllImport("shell32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);

        public static void RefreshAssociations()
        {
            try
            {
                SHChangeNotify(0x08000000, 0x0000, IntPtr.Zero, IntPtr.Zero);
            }
            catch { }
        }
    }

    public static class UninstallEngine
    {
        public static void ExecuteUninstall(
            string installDir,
            bool removeUserData,
            Action<string> log,
            Action<int> setProgress
        )
        {
            log("Stopping active NovaPDFPro processes...");
            setProgress(15);
            StopProcessesInDirectory(installDir);

            log("Removing Windows Desktop & Start Menu shortcuts...");
            setProgress(30);
            try
            {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string desktopLink = Path.Combine(desktop, "NovaPDFPro.lnk");
                if (File.Exists(desktopLink)) File.Delete(desktopLink);
            }
            catch { }

            try
            {
                string startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "NovaPDFPro");
                if (Directory.Exists(startMenu)) Directory.Delete(startMenu, true);
            }
            catch { }

            log("Cleaning Windows PDF 'Open with', Default Reader & Uninstall registry keys...");
            setProgress(55);
            RemoveRegistryKeys();
            UninstallNativeShell.RefreshAssociations();

            if (removeUserData)
            {
                log("Removing local NovaPDFPro backups, settings & license cache...");
                try
                {
                    string localData = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "NovaPDFPro"
                    );
                    if (Directory.Exists(localData))
                    {
                        Directory.Delete(localData, true);
                    }
                }
                catch { }
            }

            log("Deleting installed program files...");
            setProgress(80);

            string selfExe = Assembly.GetExecutingAssembly().Location;
            if (!string.IsNullOrEmpty(installDir) && Directory.Exists(installDir))
            {
                foreach (string subDir in Directory.GetDirectories(installDir))
                {
                    try { Directory.Delete(subDir, true); } catch { }
                }
                foreach (string file in Directory.GetFiles(installDir))
                {
                    if (!string.Equals(Path.GetFullPath(file), Path.GetFullPath(selfExe), StringComparison.OrdinalIgnoreCase))
                    {
                        try { File.Delete(file); } catch { }
                    }
                }

                string psScript = "Start-Sleep -Seconds 2; Remove-Item -LiteralPath '" +
                    installDir.Replace("'", "''") + "' -Recurse -Force -ErrorAction SilentlyContinue";
                string encodedCmd = Convert.ToBase64String(Encoding.Unicode.GetBytes(psScript));

                ProcessStartInfo cleanupPsi = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand " + encodedCmd,
                    WorkingDirectory = Path.GetTempPath(),
                    WindowStyle = ProcessWindowStyle.Hidden,
                    CreateNoWindow = true,
                    UseShellExecute = false
                };
                Process.Start(cleanupPsi);
            }

            setProgress(100);
            log("NovaPDFPro has been completely uninstalled.");
        }

        private static void RemoveRegistryKeys()
        {
            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\NovaPDFPro", false);
            }
            catch { }

            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\NovaPDFPro.PDF", false);
            }
            catch { }

            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\SystemFileAssociations\.pdf\shell\NovaPDFPro", false);
            }
            catch { }

            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\Applications\NovaPDFPro.exe", false);
            }
            catch { }

            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\NovaPDFPro", false);
            }
            catch { }

            try
            {
                using (RegistryKey openWith = Registry.CurrentUser.OpenSubKey(@"Software\Classes\.pdf\OpenWithProgids", true))
                {
                    if (openWith != null) openWith.DeleteValue("NovaPDFPro.PDF", false);
                }
            }
            catch { }

            try
            {
                using (RegistryKey regApps = Registry.CurrentUser.OpenSubKey(@"Software\RegisteredApplications", true))
                {
                    if (regApps != null) regApps.DeleteValue("NovaPDFPro", false);
                }
            }
            catch { }

            try
            {
                using (RegistryKey dotPdf = Registry.CurrentUser.OpenSubKey(@"Software\Classes\.pdf", true))
                {
                    if (dotPdf != null)
                    {
                        object cur = dotPdf.GetValue("");
                        if (cur != null && string.Equals(cur.ToString(), "NovaPDFPro.PDF", StringComparison.OrdinalIgnoreCase))
                        {
                            dotPdf.SetValue("", "");
                        }
                    }
                }
            }
            catch { }
        }

        private static void StopProcessesInDirectory(string dir)
        {
            string fullDir = Path.GetFullPath(dir).TrimEnd('\\') + "\\";
            foreach (string name in new[] { "NovaPDFPro", "electron" })
            {
                try
                {
                    foreach (Process proc in Process.GetProcessesByName(name))
                    {
                        try
                        {
                            string exePath = proc.MainModule != null ? proc.MainModule.FileName : null;
                            if (name == "NovaPDFPro" ||
                                (!string.IsNullOrEmpty(exePath) && exePath.StartsWith(fullDir, StringComparison.OrdinalIgnoreCase)))
                            {
                                proc.Kill();
                                proc.WaitForExit(2000);
                            }
                        }
                        catch { }
                    }
                }
                catch { }
            }
        }
    }

    public class UninstallWizardForm : Form
    {
        private readonly string installDir;
        private CheckBox wipeDataCheck;
        private Label statusLabel;
        private Label pctLabel;
        private ProgressBar progressBar;
        private Button uninstallBtn;
        private Button cancelBtn;
        private bool finished = false;
        private Point dragOrigin;
        private bool dragging = false;

        public UninstallWizardForm(string installDirectory)
        {
            installDir = installDirectory;
            Text = "Uninstall NovaPDFPro v01.31";
            Size = new Size(540, 390);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.None;
            BackColor = Color.FromArgb(9, 13, 22);
            ForeColor = Color.FromArgb(241, 245, 249);
            Font = new Font("Segoe UI", 9.25F);
            DoubleBuffered = true;

            try
            {
                string icoPath = Path.Combine(installDir, "NovaPDFPro.ico");
                if (File.Exists(icoPath)) Icon = new Icon(icoPath);
            }
            catch { }

            BuildUi();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            using (Pen border = new Pen(Color.FromArgb(51, 65, 85), 1))
            {
                e.Graphics.DrawRectangle(border, 0, 0, Width - 1, Height - 1);
            }
        }

        private void BuildUi()
        {
            Panel header = new Panel
            {
                Dock = DockStyle.Top,
                Height = 68,
                BackColor = Color.FromArgb(6, 10, 19)
            };
            header.MouseDown += (s, e) => { if (e.Button == MouseButtons.Left) { dragging = true; dragOrigin = new Point(e.X, e.Y); } };
            header.MouseMove += (s, e) =>
            {
                if (dragging)
                {
                    Point p = header.PointToScreen(new Point(e.X, e.Y));
                    Location = new Point(p.X - dragOrigin.X, p.Y - dragOrigin.Y);
                }
            };
            header.MouseUp += (s, e) => { dragging = false; };

            Label title = new Label
            {
                Text = "Uninstall NovaPDFPro v01.31",
                Font = new Font("Segoe UI", 14F, FontStyle.Bold),
                ForeColor = Color.White,
                Location = new Point(24, 14),
                AutoSize = true
            };
            header.Controls.Add(title);

            Label sub = new Label
            {
                Text = "Clean removal of program files, shortcuts & PDF file associations",
                Font = new Font("Segoe UI", 8.5F),
                ForeColor = Color.FromArgb(148, 163, 184),
                Location = new Point(24, 40),
                AutoSize = true
            };
            header.Controls.Add(sub);

            Button closeBtn = new Button
            {
                Text = "✕",
                Location = new Point(Width - 40, 12),
                Size = new Size(28, 28),
                BackColor = Color.Transparent,
                ForeColor = Color.FromArgb(148, 163, 184),
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            closeBtn.FlatAppearance.BorderSize = 0;
            closeBtn.Click += (s, e) => { if (cancelBtn.Enabled || finished) Close(); };
            header.Controls.Add(closeBtn);
            Controls.Add(header);

            Panel infoCard = new Panel
            {
                Location = new Point(24, 86),
                Size = new Size(492, 132),
                BackColor = Color.FromArgb(15, 23, 42)
            };
            infoCard.Paint += (s, e) =>
            {
                using (Pen p = new Pen(Color.FromArgb(30, 41, 59))) e.Graphics.DrawRectangle(p, 0, 0, infoCard.Width - 1, infoCard.Height - 1);
            };

            Label locLabel = new Label
            {
                Text = "Install Directory: " + installDir,
                Font = new Font("Consolas", 8F),
                ForeColor = Color.FromArgb(148, 163, 184),
                Location = new Point(14, 14),
                Size = new Size(464, 18)
            };
            infoCard.Controls.Add(locLabel);

            Label itemsLabel = new Label
            {
                Text = "• Terminates running NovaPDFPro processes\n• Removes Desktop & Start Menu shortcuts and Installed Apps entry\n• Unregisters 'Open with NovaPDFPro' right-click & Default PDF entries",
                Font = new Font("Segoe UI", 8.5F),
                ForeColor = Color.FromArgb(203, 213, 225),
                Location = new Point(14, 38),
                Size = new Size(464, 54)
            };
            infoCard.Controls.Add(itemsLabel);

            wipeDataCheck = new CheckBox
            {
                Text = "Also delete local user data, backups & license cache (%LOCALAPPDATA%\\NovaPDFPro)",
                Checked = false,
                Location = new Point(14, 98),
                AutoSize = true,
                ForeColor = Color.FromArgb(251, 191, 36),
                Font = new Font("Segoe UI", 8.25F),
                Cursor = Cursors.Hand
            };
            infoCard.Controls.Add(wipeDataCheck);
            Controls.Add(infoCard);

            statusLabel = new Label
            {
                Text = "Click Uninstall to remove NovaPDFPro from your computer.",
                Font = new Font("Segoe UI", 8.75F, FontStyle.Bold),
                ForeColor = Color.FromArgb(226, 232, 240),
                Location = new Point(24, 238),
                Size = new Size(420, 20)
            };
            Controls.Add(statusLabel);

            pctLabel = new Label
            {
                Text = "0%",
                Font = new Font("Consolas", 8.75F, FontStyle.Bold),
                ForeColor = Color.FromArgb(248, 113, 113),
                Location = new Point(456, 238),
                Size = new Size(60, 20),
                TextAlign = ContentAlignment.MiddleRight
            };
            Controls.Add(pctLabel);

            progressBar = new ProgressBar
            {
                Location = new Point(24, 266),
                Size = new Size(492, 16),
                Style = ProgressBarStyle.Continuous,
                Value = 0
            };
            Controls.Add(progressBar);

            cancelBtn = new Button
            {
                Text = "Cancel",
                Location = new Point(268, 326),
                Size = new Size(96, 34),
                BackColor = Color.FromArgb(30, 41, 59),
                ForeColor = Color.FromArgb(226, 232, 240),
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            cancelBtn.FlatAppearance.BorderColor = Color.FromArgb(71, 85, 105);
            cancelBtn.Click += (s, e) => Close();
            Controls.Add(cancelBtn);

            uninstallBtn = new Button
            {
                Text = "Uninstall",
                Location = new Point(376, 326),
                Size = new Size(140, 34),
                BackColor = Color.FromArgb(220, 38, 38),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9.5F, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            uninstallBtn.FlatAppearance.BorderSize = 0;
            uninstallBtn.Click += (s, e) =>
            {
                if (finished)
                {
                    Close();
                    return;
                }
                StartUninstall();
            };
            Controls.Add(uninstallBtn);
        }

        private void Log(string msg)
        {
            if (InvokeRequired)
            {
                Invoke(new Action<string>(Log), msg);
                return;
            }
            statusLabel.Text = msg;
        }

        private void SetProgress(int value)
        {
            if (InvokeRequired)
            {
                Invoke(new Action<int>(SetProgress), value);
                return;
            }
            if (value >= 0 && value <= 100)
            {
                progressBar.Value = value;
                pctLabel.Text = value + "%";
            }
        }

        private async void StartUninstall()
        {
            uninstallBtn.Enabled = false;
            cancelBtn.Enabled = false;
            wipeDataCheck.Enabled = false;
            bool wipeData = wipeDataCheck.Checked;

            await Task.Run(() =>
            {
                try
                {
                    UninstallEngine.ExecuteUninstall(installDir, wipeData, Log, SetProgress);
                    Invoke(new Action(() =>
                    {
                        finished = true;
                        statusLabel.ForeColor = Color.FromArgb(52, 211, 153);
                        pctLabel.ForeColor = Color.FromArgb(52, 211, 153);
                        uninstallBtn.Text = "Close";
                        uninstallBtn.BackColor = Color.FromArgb(16, 185, 129);
                        uninstallBtn.Enabled = true;
                        cancelBtn.Visible = false;
                    }));
                }
                catch (Exception ex)
                {
                    Log("Uninstall warning: " + ex.Message);
                    Invoke(new Action(() =>
                    {
                        uninstallBtn.Enabled = true;
                        cancelBtn.Enabled = true;
                    }));
                }
            });
        }
    }

    public class Uninstaller
    {
        [STAThread]
        public static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool silent = false;
            bool wipeData = false;
            foreach (string arg in args)
            {
                if (string.Equals(arg, "/S", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(arg, "--silent", StringComparison.OrdinalIgnoreCase))
                {
                    silent = true;
                }
                else if (string.Equals(arg, "--wipe-data", StringComparison.OrdinalIgnoreCase))
                {
                    wipeData = true;
                }
            }

            string installDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');

            if (silent)
            {
                try
                {
                    UninstallEngine.ExecuteUninstall(installDir, wipeData, delegate { }, delegate { });
                }
                catch { }
                return;
            }

            Application.Run(new UninstallWizardForm(installDir));
        }
    }
}
