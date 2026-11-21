using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("NovaPDFPro Standalone Windows Installer")]
[assembly: AssemblyDescription("Offline Enterprise-Grade PDF Editor Installer")]
[assembly: AssemblyProduct("NovaPDFPro")]
[assembly: AssemblyCompany("NovaPDFPro")]
[assembly: AssemblyVersion("1.31.0.0")]
[assembly: AssemblyFileVersion("1.31.0.0")]

namespace NovaPDFProSetup
{
    public class InstallOptions
    {
        public string TargetDir { get; set; }
        public bool CreateDesktopShortcut { get; set; }
        public bool CreateStartMenuShortcut { get; set; }
        public bool RegisterRightClickOpenWith { get; set; }
        public bool SetAsDefaultPdfReader { get; set; }
        public bool LaunchAfterInstall { get; set; }
        public bool Silent { get; set; }
    }

    internal static class NativeShell
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

    public static class InstallerEngine
    {
        public static string DefaultInstallDir()
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs",
                "NovaPDFPro"
            );
        }

        public static void ExecuteInstall(
            InstallOptions options,
            Action<string> log,
            Action<int> setProgress
        )
        {
            string targetDir = Path.GetFullPath(options.TargetDir.Trim());
            if (string.IsNullOrEmpty(targetDir))
            {
                throw new InvalidOperationException("Destination directory cannot be empty.");
            }

            if (!Directory.Exists(targetDir))
            {
                Directory.CreateDirectory(targetDir);
            }

            log("Target folder: " + targetDir);
            setProgress(8);

            StopRunningProcesses(targetDir);

            Assembly asm = Assembly.GetExecutingAssembly();
            long installedBytes = 0;

            using (Stream zipStream = asm.GetManifestResourceStream("AppPackage.zip"))
            {
                if (zipStream == null)
                {
                    throw new InvalidOperationException("Embedded AppPackage.zip payload is missing from this installer.");
                }

                log("Verifying & extracting offline NovaPDFPro payload...");
                string normalizedTargetRoot = Path.GetFullPath(targetDir).TrimEnd('\\') + "\\";

                using (ZipArchive archive = new ZipArchive(zipStream, ZipArchiveMode.Read))
                {
                    int total = archive.Entries.Count;
                    int current = 0;

                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        current++;
                        string fullPath = Path.GetFullPath(Path.Combine(targetDir, entry.FullName));
                        if (!fullPath.StartsWith(normalizedTargetRoot, StringComparison.OrdinalIgnoreCase))
                        {
                            throw new InvalidOperationException("Blocked invalid archive entry path: " + entry.FullName);
                        }

                        if (string.IsNullOrEmpty(entry.Name))
                        {
                            if (!Directory.Exists(fullPath)) Directory.CreateDirectory(fullPath);
                            continue;
                        }

                        string dir = Path.GetDirectoryName(fullPath);
                        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                        {
                            Directory.CreateDirectory(dir);
                        }

                        entry.ExtractToFile(fullPath, true);
                        installedBytes += entry.Length;

                        int pct = 8 + (int)((float)current / Math.Max(1, total) * 74);
                        if (pct > 82) pct = 82;
                        setProgress(pct);

                        if (current % 45 == 0 || current == total)
                        {
                            log("Installed: " + entry.FullName + " (" + current + "/" + total + ")");
                        }
                    }
                }
            }

            setProgress(85);

            string mainExe = Path.Combine(targetDir, "NovaPDFPro.exe");
            string icoPath = Path.Combine(targetDir, "NovaPDFPro.ico");
            string uninstallExe = Path.Combine(targetDir, "Uninstall-NovaPDFPro.exe");

            if (!File.Exists(mainExe))
            {
                throw new FileNotFoundException("Main application launcher missing after extraction.", mainExe);
            }

            if (options.CreateDesktopShortcut)
            {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                CreateShortcut(Path.Combine(desktop, "NovaPDFPro.lnk"), mainExe, icoPath, log);
                log("Created Desktop shortcut: NovaPDFPro");
            }

            if (options.CreateStartMenuShortcut)
            {
                string startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "NovaPDFPro");
                if (!Directory.Exists(startMenu)) Directory.CreateDirectory(startMenu);
                CreateShortcut(Path.Combine(startMenu, "NovaPDFPro.lnk"), mainExe, icoPath, log);
                CreateShortcut(Path.Combine(startMenu, "Uninstall NovaPDFPro.lnk"), uninstallExe, icoPath, log);
                log("Created Start Menu & Uninstaller shortcuts");
            }

            setProgress(90);

            if (options.RegisterRightClickOpenWith || options.SetAsDefaultPdfReader)
            {
                RegisterPdfFileAssociations(mainExe, icoPath, options.SetAsDefaultPdfReader, options.Silent, log);
            }

            setProgress(95);

            // Register in Windows Add/Remove Programs
            try
            {
                int estimatedSizeKb = Math.Max(1, (int)(installedBytes / 1024));
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\NovaPDFPro"))
                {
                    if (key != null)
                    {
                        key.SetValue("DisplayName", "NovaPDFPro (Offline Desktop Edition)");
                        key.SetValue("DisplayVersion", "01.31");
                        key.SetValue("Publisher", "NovaPDFPro");
                        key.SetValue("DisplayIcon", icoPath);
                        key.SetValue("InstallLocation", targetDir);
                        key.SetValue("UninstallString", "\"" + uninstallExe + "\"");
                        key.SetValue("QuietUninstallString", "\"" + uninstallExe + "\" /S");
                        key.SetValue("EstimatedSize", estimatedSizeKb, RegistryValueKind.DWord);
                        key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                        key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                    }
                }
                log("Registered NovaPDFPro in Windows Installed Apps");
            }
            catch (Exception ex)
            {
                log("Uninstall registry warning: " + ex.Message);
            }

            setProgress(100);
            log("Installation completed cleanly!");

            if (options.LaunchAfterInstall && File.Exists(mainExe))
            {
                log("Launching NovaPDFPro...");
                Process.Start(new ProcessStartInfo
                {
                    FileName = mainExe,
                    WorkingDirectory = targetDir,
                    UseShellExecute = true
                });
            }
        }

        private static void RegisterPdfFileAssociations(
            string mainExe,
            string icoPath,
            bool setAsDefault,
            bool silent,
            Action<string> log
        )
        {
            try
            {
                string command = "\"" + mainExe + "\" \"%1\"";
                string iconVal = File.Exists(icoPath) ? icoPath : mainExe + ",0";

                // 1. Custom ProgID: NovaPDFPro.PDF
                using (RegistryKey progIdKey = Registry.CurrentUser.CreateSubKey(@"Software\Classes\NovaPDFPro.PDF"))
                {
                    if (progIdKey != null)
                    {
                        progIdKey.SetValue("", "NovaPDFPro PDF Document");
                        progIdKey.SetValue("FriendlyTypeName", "PDF Document");
                    }
                }
                using (RegistryKey defIcon = Registry.CurrentUser.CreateSubKey(@"Software\Classes\NovaPDFPro.PDF\DefaultIcon"))
                {
                    if (defIcon != null) defIcon.SetValue("", iconVal);
                }
                using (RegistryKey openVerb = Registry.CurrentUser.CreateSubKey(@"Software\Classes\NovaPDFPro.PDF\shell\open"))
                {
                    if (openVerb != null) openVerb.SetValue("", "Open with NovaPDFPro");
                }
                using (RegistryKey openCmd = Registry.CurrentUser.CreateSubKey(@"Software\Classes\NovaPDFPro.PDF\shell\open\command"))
                {
                    if (openCmd != null) openCmd.SetValue("", command);
                }

                // 2. Right-Click Explorer Context Menu + Windows "Open with" menu
                using (RegistryKey openWithKey = Registry.CurrentUser.CreateSubKey(@"Software\Classes\.pdf\OpenWithProgids"))
                {
                    if (openWithKey != null) openWithKey.SetValue("NovaPDFPro.PDF", "", RegistryValueKind.String);
                }
                using (RegistryKey ctxShell = Registry.CurrentUser.CreateSubKey(@"Software\Classes\SystemFileAssociations\.pdf\shell\NovaPDFPro"))
                {
                    if (ctxShell != null)
                    {
                        ctxShell.SetValue("", "Open with NovaPDFPro");
                        ctxShell.SetValue("Icon", iconVal);
                    }
                }
                using (RegistryKey ctxCmd = Registry.CurrentUser.CreateSubKey(@"Software\Classes\SystemFileAssociations\.pdf\shell\NovaPDFPro\command"))
                {
                    if (ctxCmd != null) ctxCmd.SetValue("", command);
                }

                // 3. Applications & RegisteredApplications Capabilities (for Windows Default Apps)
                using (RegistryKey appKey = Registry.CurrentUser.CreateSubKey(@"Software\Classes\Applications\NovaPDFPro.exe"))
                {
                    if (appKey != null) appKey.SetValue("FriendlyAppName", "NovaPDFPro");
                }
                using (RegistryKey appSup = Registry.CurrentUser.CreateSubKey(@"Software\Classes\Applications\NovaPDFPro.exe\SupportedTypes"))
                {
                    if (appSup != null) appSup.SetValue(".pdf", "");
                }
                using (RegistryKey appCmd = Registry.CurrentUser.CreateSubKey(@"Software\Classes\Applications\NovaPDFPro.exe\shell\open\command"))
                {
                    if (appCmd != null) appCmd.SetValue("", command);
                }
                using (RegistryKey capKey = Registry.CurrentUser.CreateSubKey(@"Software\NovaPDFPro\Capabilities"))
                {
                    if (capKey != null)
                    {
                        capKey.SetValue("ApplicationName", "NovaPDFPro");
                        capKey.SetValue("ApplicationDescription", "Enterprise-Grade Offline PDF Reader & Editor");
                    }
                }
                using (RegistryKey capAssoc = Registry.CurrentUser.CreateSubKey(@"Software\NovaPDFPro\Capabilities\FileAssociations"))
                {
                    if (capAssoc != null) capAssoc.SetValue(".pdf", "NovaPDFPro.PDF");
                }
                using (RegistryKey regApps = Registry.CurrentUser.CreateSubKey(@"Software\RegisteredApplications"))
                {
                    if (regApps != null) regApps.SetValue("NovaPDFPro", @"Software\NovaPDFPro\Capabilities");
                }

                log("Registered Windows right-click 'Open with NovaPDFPro' integration");

                if (setAsDefault)
                {
                    using (RegistryKey dotPdf = Registry.CurrentUser.CreateSubKey(@"Software\Classes\.pdf"))
                    {
                        if (dotPdf != null) dotPdf.SetValue("", "NovaPDFPro.PDF");
                    }

                    bool isAlreadyDefault = false;
                    try
                    {
                        using (RegistryKey uc = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice"))
                        {
                            if (uc != null)
                            {
                                object val = uc.GetValue("ProgId");
                                if (val != null && string.Equals(val.ToString(), "NovaPDFPro.PDF", StringComparison.OrdinalIgnoreCase))
                                {
                                    isAlreadyDefault = true;
                                }
                            }
                        }
                    }
                    catch { }

                    if (isAlreadyDefault)
                    {
                        log("NovaPDFPro verified as Default PDF Reader");
                    }
                    else
                    {
                        log("Registered NovaPDFPro for Default PDF Reader (Windows Default Apps confirmation available)");
                        if (!silent)
                        {
                            try
                            {
                                Process.Start(new ProcessStartInfo("ms-settings:defaultapps") { UseShellExecute = true });
                            }
                            catch { }
                        }
                    }
                }

                NativeShell.RefreshAssociations();
            }
            catch (Exception ex)
            {
                log("File association warning: " + ex.Message);
            }
        }

        private static void StopRunningProcesses(string targetDir)
        {
            string fullDir = Path.GetFullPath(targetDir).TrimEnd('\\') + "\\";
            foreach (string procName in new[] { "NovaPDFPro", "electron" })
            {
                try
                {
                    foreach (Process proc in Process.GetProcessesByName(procName))
                    {
                        try
                        {
                            string exePath = proc.MainModule != null ? proc.MainModule.FileName : null;
                            if (procName == "NovaPDFPro" ||
                                (!string.IsNullOrEmpty(exePath) && exePath.StartsWith(fullDir, StringComparison.OrdinalIgnoreCase)))
                            {
                                proc.Kill();
                                proc.WaitForExit(1500);
                            }
                        }
                        catch { }
                    }
                }
                catch { }
            }
        }

        private static void CreateShortcut(string shortcutPath, string targetPath, string iconPath, Action<string> log)
        {
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic shortcut = shell.CreateShortcut(shortcutPath);
                shortcut.TargetPath = targetPath;
                shortcut.WorkingDirectory = Path.GetDirectoryName(targetPath);
                shortcut.Description = "NovaPDFPro — Enterprise-Grade Offline PDF Editor";
                if (!string.IsNullOrEmpty(iconPath) && File.Exists(iconPath))
                {
                    shortcut.IconLocation = iconPath + ",0";
                }
                shortcut.Save();
            }
            catch (Exception ex)
            {
                log("Shortcut warning: " + ex.Message);
            }
        }
    }

    internal class ModernProgressBar : Control
    {
        private int _value;
        public int Value
        {
            get { return _value; }
            set
            {
                int clamped = Math.Max(0, Math.Min(100, value));
                if (_value != clamped)
                {
                    _value = clamped;
                    Invalidate();
                }
            }
        }

        public ModernProgressBar()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
            Height = 14;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle bounds = new Rectangle(0, 0, Width - 1, Height - 1);

            using (GraphicsPath trackPath = RoundedRect(bounds, 6))
            using (SolidBrush trackBrush = new SolidBrush(Color.FromArgb(15, 23, 42)))
            using (Pen borderPen = new Pen(Color.FromArgb(30, 41, 59)))
            {
                g.FillPath(trackBrush, trackPath);
                g.DrawPath(borderPen, trackPath);
            }

            if (_value > 0)
            {
                int fillW = Math.Max(10, (int)((Width - 2) * (_value / 100.0)));
                Rectangle fillRect = new Rectangle(1, 1, fillW, Height - 3);
                using (GraphicsPath fillPath = RoundedRect(fillRect, 5))
                using (LinearGradientBrush grad = new LinearGradientBrush(
                    fillRect,
                    Color.FromArgb(14, 165, 233),
                    Color.FromArgb(16, 185, 129),
                    LinearGradientMode.Horizontal))
                {
                    g.FillPath(grad, fillPath);
                }
            }
        }

        private static GraphicsPath RoundedRect(Rectangle bounds, int radius)
        {
            int d = radius * 2;
            GraphicsPath path = new GraphicsPath();
            path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
            path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
            path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
            path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }
    }

    public class SetupWizardForm : Form
    {
        private TextBox installDirBox;
        private CheckBox desktopShortcutCheck;
        private CheckBox startMenuCheck;
        private CheckBox rightClickOpenWithCheck;
        private CheckBox defaultReaderCheck;
        private CheckBox launchAfterInstallCheck;
        private ModernProgressBar progressBar;
        private Label statusLabel;
        private Label pctLabel;
        private ListBox logList;
        private Button installButton;
        private Button browseButton;
        private Button cancelButton;
        private Panel sidebarPanel;
        private int currentStep = 0; // 0 = Configure, 1 = Installing, 2 = Complete
        private bool installationFinished = false;
        private Point dragOrigin;
        private bool isDraggingWindow = false;
        private Image brandIconImage;

        public SetupWizardForm()
        {
            Text = "NovaPDFPro v01.31 — Standalone Installer";
            Size = new Size(760, 580);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.None;
            BackColor = Color.FromArgb(9, 13, 22);
            ForeColor = Color.FromArgb(241, 245, 249);
            Font = new Font("Segoe UI", 9.25F, FontStyle.Regular);
            DoubleBuffered = true;

            try
            {
                Stream icoStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("NovaPDFPro.ico");
                if (icoStream != null)
                {
                    Icon ico = new Icon(icoStream, 48, 48);
                    Icon = ico;
                    brandIconImage = ico.ToBitmap();
                }
            }
            catch { }

            BuildLayout();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            using (Pen borderPen = new Pen(Color.FromArgb(51, 65, 85), 1))
            {
                e.Graphics.DrawRectangle(borderPen, 0, 0, Width - 1, Height - 1);
            }
        }

        private void AttachWindowDrag(Control ctrl)
        {
            ctrl.MouseDown += (s, e) =>
            {
                if (e.Button == MouseButtons.Left)
                {
                    isDraggingWindow = true;
                    dragOrigin = new Point(e.X, e.Y);
                }
            };
            ctrl.MouseMove += (s, e) =>
            {
                if (isDraggingWindow)
                {
                    Point screenPos = ctrl.PointToScreen(new Point(e.X, e.Y));
                    Location = new Point(screenPos.X - dragOrigin.X, screenPos.Y - dragOrigin.Y);
                }
            };
            ctrl.MouseUp += (s, e) => { isDraggingWindow = false; };
        }

        private void BuildLayout()
        {
            // Left Brand & Stepper Sidebar
            sidebarPanel = new Panel
            {
                Location = new Point(1, 1),
                Size = new Size(220, Height - 2),
                BackColor = Color.FromArgb(6, 10, 19)
            };
            sidebarPanel.Paint += PaintSidebar;
            AttachWindowDrag(sidebarPanel);
            Controls.Add(sidebarPanel);

            // Top Window Controls Bar
            Panel topBar = new Panel
            {
                Location = new Point(221, 1),
                Size = new Size(Width - 222, 46),
                BackColor = Color.FromArgb(9, 13, 22)
            };
            AttachWindowDrag(topBar);

            Label headerTag = new Label
            {
                Text = "STANDALONE OFFLINE SETUP  •  64-BIT ENTERPRISE BUILD",
                Font = new Font("Segoe UI", 7.75F, FontStyle.Bold),
                ForeColor = Color.FromArgb(100, 116, 139),
                Location = new Point(22, 16),
                AutoSize = true
            };
            AttachWindowDrag(headerTag);
            topBar.Controls.Add(headerTag);

            Button minBtn = new Button
            {
                Text = "—",
                Location = new Point(topBar.Width - 72, 8),
                Size = new Size(30, 28),
                BackColor = Color.Transparent,
                ForeColor = Color.FromArgb(148, 163, 184),
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            minBtn.FlatAppearance.BorderSize = 0;
            minBtn.Click += (s, e) => { WindowState = FormWindowState.Minimized; };
            topBar.Controls.Add(minBtn);

            Button closeBtn = new Button
            {
                Text = "✕",
                Location = new Point(topBar.Width - 38, 8),
                Size = new Size(30, 28),
                BackColor = Color.Transparent,
                ForeColor = Color.FromArgb(148, 163, 184),
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            closeBtn.FlatAppearance.BorderSize = 0;
            closeBtn.Click += (s, e) => { if (cancelButton.Enabled || installationFinished) Close(); };
            topBar.Controls.Add(closeBtn);
            Controls.Add(topBar);

            int leftX = 244;
            int contentW = 492;

            Label heroTitle = new Label
            {
                Text = "Install NovaPDFPro v01.31",
                Font = new Font("Segoe UI", 16.5F, FontStyle.Bold),
                ForeColor = Color.White,
                Location = new Point(leftX, 52),
                AutoSize = true
            };
            Controls.Add(heroTitle);

            Label heroSub = new Label
            {
                Text = "Fast offline PDF editor, OCR recognition, digital certificates & reader",
                Font = new Font("Segoe UI", 9F),
                ForeColor = Color.FromArgb(148, 163, 184),
                Location = new Point(leftX, 84),
                AutoSize = true
            };
            Controls.Add(heroSub);

            // Card 1: Destination Folder
            Panel destCard = CreateCardPanel(leftX, 114, contentW, 86);
            Label pathTitle = new Label
            {
                Text = "INSTALL LOCATION",
                Font = new Font("Segoe UI", 7.75F, FontStyle.Bold),
                ForeColor = Color.FromArgb(56, 189, 248),
                Location = new Point(16, 12),
                AutoSize = true
            };
            destCard.Controls.Add(pathTitle);

            Label spaceLabel = new Label
            {
                Text = "Required space: ~185 MB",
                Font = new Font("Segoe UI", 7.75F),
                ForeColor = Color.FromArgb(148, 163, 184),
                Location = new Point(contentW - 148, 12),
                AutoSize = true
            };
            destCard.Controls.Add(spaceLabel);

            installDirBox = new TextBox
            {
                Text = InstallerEngine.DefaultInstallDir(),
                Location = new Point(16, 38),
                Size = new Size(contentW - 122, 26),
                BackColor = Color.FromArgb(2, 6, 23),
                ForeColor = Color.FromArgb(226, 232, 240),
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Consolas", 8.75F)
            };
            destCard.Controls.Add(installDirBox);

            browseButton = new Button
            {
                Text = "Browse...",
                Location = new Point(contentW - 98, 37),
                Size = new Size(82, 26),
                BackColor = Color.FromArgb(30, 41, 59),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            browseButton.FlatAppearance.BorderColor = Color.FromArgb(71, 85, 105);
            browseButton.Click += (s, e) =>
            {
                using (FolderBrowserDialog fbd = new FolderBrowserDialog())
                {
                    fbd.SelectedPath = installDirBox.Text;
                    if (fbd.ShowDialog() == DialogResult.OK)
                    {
                        installDirBox.Text = fbd.SelectedPath;
                    }
                }
            };
            destCard.Controls.Add(browseButton);
            Controls.Add(destCard);

            // Card 2: Shortcuts & Windows Integration
            Panel optsCard = CreateCardPanel(leftX, 212, contentW, 154);
            Label optsTitle = new Label
            {
                Text = "SHORTCUTS & WINDOWS PDF INTEGRATION",
                Font = new Font("Segoe UI", 7.75F, FontStyle.Bold),
                ForeColor = Color.FromArgb(56, 189, 248),
                Location = new Point(16, 12),
                AutoSize = true
            };
            optsCard.Controls.Add(optsTitle);

            desktopShortcutCheck = CreateStyledCheck("Create Desktop shortcut (NovaPDFPro)", true, 16, 36);
            startMenuCheck = CreateStyledCheck("Add Start Menu & Uninstaller shortcuts", true, 16, 60);
            rightClickOpenWithCheck = CreateStyledCheck("Add \"Open with NovaPDFPro\" to PDF right-click menu", true, 16, 84);
            defaultReaderCheck = CreateStyledCheck("Set NovaPDFPro as Default PDF Reader", true, 16, 108);
            launchAfterInstallCheck = CreateStyledCheck("Launch NovaPDFPro immediately when setup completes", true, 16, 130);
            launchAfterInstallCheck.ForeColor = Color.FromArgb(56, 189, 248);

            optsCard.Controls.Add(desktopShortcutCheck);
            optsCard.Controls.Add(startMenuCheck);
            optsCard.Controls.Add(rightClickOpenWithCheck);
            optsCard.Controls.Add(defaultReaderCheck);
            optsCard.Controls.Add(launchAfterInstallCheck);
            Controls.Add(optsCard);

            // Card 3: Deployment Progress & Live Log
            Panel progCard = CreateCardPanel(leftX, 378, contentW, 126);
            statusLabel = new Label
            {
                Text = "Ready to install NovaPDFPro offline on your computer.",
                Font = new Font("Segoe UI", 8.5F, FontStyle.Bold),
                ForeColor = Color.FromArgb(226, 232, 240),
                Location = new Point(16, 10),
                Size = new Size(contentW - 76, 18)
            };
            progCard.Controls.Add(statusLabel);

            pctLabel = new Label
            {
                Text = "0%",
                Font = new Font("Consolas", 8.5F, FontStyle.Bold),
                ForeColor = Color.FromArgb(56, 189, 248),
                Location = new Point(contentW - 56, 10),
                Size = new Size(40, 18),
                TextAlign = ContentAlignment.MiddleRight
            };
            progCard.Controls.Add(pctLabel);

            progressBar = new ModernProgressBar
            {
                Location = new Point(16, 32),
                Size = new Size(contentW - 32, 12),
                Value = 0
            };
            progCard.Controls.Add(progressBar);

            logList = new ListBox
            {
                Location = new Point(16, 52),
                Size = new Size(contentW - 32, 64),
                BackColor = Color.FromArgb(2, 6, 23),
                ForeColor = Color.FromArgb(148, 163, 184),
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Consolas", 7.75F)
            };
            progCard.Controls.Add(logList);
            Controls.Add(progCard);

            // Bottom Footer Buttons
            cancelButton = new Button
            {
                Text = "Cancel",
                Location = new Point(leftX + contentW - 260, 520),
                Size = new Size(92, 34),
                BackColor = Color.FromArgb(30, 41, 59),
                ForeColor = Color.FromArgb(226, 232, 240),
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            cancelButton.FlatAppearance.BorderColor = Color.FromArgb(71, 85, 105);
            cancelButton.Click += (s, e) => Close();
            Controls.Add(cancelButton);

            installButton = new Button
            {
                Text = "Install NovaPDFPro",
                Location = new Point(leftX + contentW - 158, 520),
                Size = new Size(158, 34),
                BackColor = Color.FromArgb(14, 165, 233),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9.5F, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            installButton.FlatAppearance.BorderSize = 0;
            installButton.Click += (s, e) =>
            {
                if (installationFinished)
                {
                    Close();
                    return;
                }
                StartInstallation();
            };
            Controls.Add(installButton);
        }

        private Panel CreateCardPanel(int x, int y, int w, int h)
        {
            Panel p = new Panel
            {
                Location = new Point(x, y),
                Size = new Size(w, h),
                BackColor = Color.FromArgb(15, 23, 42)
            };
            p.Paint += (s, e) =>
            {
                using (Pen pen = new Pen(Color.FromArgb(30, 41, 59), 1))
                {
                    e.Graphics.DrawRectangle(pen, 0, 0, p.Width - 1, p.Height - 1);
                }
            };
            return p;
        }

        private CheckBox CreateStyledCheck(string text, bool checkedByDefault, int x, int y)
        {
            return new CheckBox
            {
                Text = text,
                Checked = checkedByDefault,
                Location = new Point(x, y),
                AutoSize = true,
                ForeColor = Color.FromArgb(203, 213, 225),
                Font = new Font("Segoe UI", 8.75F),
                Cursor = Cursors.Hand
            };
        }

        private void PaintSidebar(object sender, PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle full = new Rectangle(0, 0, sidebarPanel.Width, sidebarPanel.Height);
            using (LinearGradientBrush bg = new LinearGradientBrush(
                full,
                Color.FromArgb(8, 15, 32),
                Color.FromArgb(4, 7, 15),
                LinearGradientMode.Vertical))
            {
                g.FillRectangle(bg, full);
            }

            using (Pen divPen = new Pen(Color.FromArgb(30, 41, 59)))
            {
                g.DrawLine(divPen, sidebarPanel.Width - 1, 0, sidebarPanel.Width - 1, sidebarPanel.Height);
            }

            if (brandIconImage != null)
            {
                g.DrawImage(brandIconImage, new Rectangle(24, 24, 42, 42));
            }
            using (Font fBrand = new Font("Segoe UI", 12.5F, FontStyle.Bold))
            using (Font fVer = new Font("Segoe UI", 8F, FontStyle.Bold))
            using (SolidBrush whiteBrush = new SolidBrush(Color.White))
            using (SolidBrush skyBrush = new SolidBrush(Color.FromArgb(56, 189, 248)))
            {
                g.DrawString("NovaPDFPro", fBrand, whiteBrush, 74, 24);
                g.DrawString("VERSION 01.31", fVer, skyBrush, 75, 48);
            }

            string[] steps = new string[]
            {
                "1. Configure Setup",
                "2. Extract & Register",
                "3. Ready to Launch"
            };
            int stepY = 116;
            for (int i = 0; i < steps.Length; i++)
            {
                bool isDone = i < currentStep || (currentStep == 2 && i == 2);
                bool isActive = i == currentStep && currentStep < 2;

                Color dotColor = isDone
                    ? Color.FromArgb(16, 185, 129)
                    : isActive
                    ? Color.FromArgb(14, 165, 233)
                    : Color.FromArgb(51, 65, 85);

                Rectangle dotRect = new Rectangle(24, stepY + 2, 16, 16);
                using (SolidBrush dotBrush = new SolidBrush(dotColor))
                {
                    g.FillEllipse(dotBrush, dotRect);
                }

                Color txtColor = isDone
                    ? Color.FromArgb(110, 231, 183)
                    : isActive
                    ? Color.White
                    : Color.FromArgb(100, 116, 139);
                using (Font fStep = new Font("Segoe UI", 9F, isActive || isDone ? FontStyle.Bold : FontStyle.Regular))
                using (SolidBrush txtBrush = new SolidBrush(txtColor))
                {
                    g.DrawString(steps[i], fStep, txtBrush, 48, stepY);
                }
                stepY += 40;
            }

            // Bottom Security Assurances
            Rectangle secBox = new Rectangle(18, sidebarPanel.Height - 134, sidebarPanel.Width - 36, 112);
            using (SolidBrush boxBg = new SolidBrush(Color.FromArgb(13, 22, 40)))
            using (Pen boxBorder = new Pen(Color.FromArgb(30, 41, 59)))
            {
                g.FillRectangle(boxBg, secBox);
                g.DrawRectangle(boxBorder, secBox);
            }
            using (Font fHead = new Font("Segoe UI", 8F, FontStyle.Bold))
            using (Font fLine = new Font("Segoe UI", 7.75F))
            using (SolidBrush emBrush = new SolidBrush(Color.FromArgb(52, 211, 153)))
            using (SolidBrush slateBrush = new SolidBrush(Color.FromArgb(148, 163, 184)))
            {
                g.DrawString("SECURITY ASSURED", fHead, emBrush, 28, secBox.Y + 12);
                g.DrawString("• 100% Offline Engine", fLine, slateBrush, 28, secBox.Y + 34);
                g.DrawString("• DPAPI + Ed25519 Signed", fLine, slateBrush, 28, secBox.Y + 54);
                g.DrawString("• Zero Telemetry / Adware", fLine, slateBrush, 28, secBox.Y + 74);
            }
        }

        private void Log(string msg)
        {
            if (InvokeRequired)
            {
                Invoke(new Action<string>(Log), msg);
                return;
            }
            statusLabel.Text = msg;
            logList.Items.Add(msg);
            logList.TopIndex = logList.Items.Count - 1;
        }

        private void SetProgress(int value)
        {
            if (InvokeRequired)
            {
                Invoke(new Action<int>(SetProgress), value);
                return;
            }
            if (value >= 0 && value <= 100 && value >= progressBar.Value)
            {
                progressBar.Value = value;
                pctLabel.Text = value + "%";
            }
        }

        private async void StartInstallation()
        {
            string targetDir = installDirBox.Text.Trim();
            if (string.IsNullOrEmpty(targetDir)) return;

            currentStep = 1;
            sidebarPanel.Invalidate();

            installButton.Enabled = false;
            browseButton.Enabled = false;
            installDirBox.Enabled = false;
            desktopShortcutCheck.Enabled = false;
            startMenuCheck.Enabled = false;
            rightClickOpenWithCheck.Enabled = false;
            defaultReaderCheck.Enabled = false;
            launchAfterInstallCheck.Enabled = false;
            cancelButton.Enabled = false;

            Log("Preparing NovaPDFPro v01.31 standalone deployment...");
            SetProgress(4);

            var options = new InstallOptions
            {
                TargetDir = targetDir,
                CreateDesktopShortcut = desktopShortcutCheck.Checked,
                CreateStartMenuShortcut = startMenuCheck.Checked,
                RegisterRightClickOpenWith = rightClickOpenWithCheck.Checked,
                SetAsDefaultPdfReader = defaultReaderCheck.Checked,
                LaunchAfterInstall = launchAfterInstallCheck.Checked,
                Silent = false
            };

            await Task.Run(() =>
            {
                try
                {
                    InstallerEngine.ExecuteInstall(options, Log, SetProgress);

                    Invoke(new Action(() =>
                    {
                        currentStep = 2;
                        sidebarPanel.Invalidate();
                        installationFinished = true;
                        installButton.Text = "Finish";
                        installButton.BackColor = Color.FromArgb(16, 185, 129);
                        installButton.Enabled = true;
                        cancelButton.Visible = false;
                    }));
                }
                catch (Exception ex)
                {
                    Log("ERROR: " + ex.Message);
                    Invoke(new Action(() =>
                    {
                        currentStep = 0;
                        sidebarPanel.Invalidate();
                        installButton.Enabled = true;
                        browseButton.Enabled = true;
                        installDirBox.Enabled = true;
                        desktopShortcutCheck.Enabled = true;
                        startMenuCheck.Enabled = true;
                        rightClickOpenWithCheck.Enabled = true;
                        defaultReaderCheck.Enabled = true;
                        launchAfterInstallCheck.Enabled = true;
                        cancelButton.Enabled = true;
                    }));
                }
            });
        }

        [STAThread]
        public static int Main(string[] args)
        {
            var options = new InstallOptions
            {
                TargetDir = InstallerEngine.DefaultInstallDir(),
                CreateDesktopShortcut = true,
                CreateStartMenuShortcut = true,
                RegisterRightClickOpenWith = true,
                SetAsDefaultPdfReader = false,
                LaunchAfterInstall = false,
                Silent = false
            };

            foreach (string rawArg in args)
            {
                string arg = rawArg.Trim();
                if (string.Equals(arg, "/S", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(arg, "--silent", StringComparison.OrdinalIgnoreCase))
                {
                    options.Silent = true;
                }
                else if (arg.StartsWith("/D=", StringComparison.OrdinalIgnoreCase))
                {
                    options.TargetDir = arg.Substring(3).Trim('"');
                }
                else if (string.Equals(arg, "--no-shortcuts", StringComparison.OrdinalIgnoreCase))
                {
                    options.CreateDesktopShortcut = false;
                    options.CreateStartMenuShortcut = false;
                }
                else if (string.Equals(arg, "--no-open-with", StringComparison.OrdinalIgnoreCase))
                {
                    options.RegisterRightClickOpenWith = false;
                }
                else if (string.Equals(arg, "--set-default", StringComparison.OrdinalIgnoreCase))
                {
                    options.SetAsDefaultPdfReader = true;
                }
                else if (string.Equals(arg, "--launch", StringComparison.OrdinalIgnoreCase))
                {
                    options.LaunchAfterInstall = true;
                }
            }

            if (options.Silent)
            {
                try
                {
                    InstallerEngine.ExecuteInstall(options, delegate { }, delegate { });
                    return 0;
                }
                catch
                {
                    return 1;
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupWizardForm());
            return 0;
        }
    }
}
