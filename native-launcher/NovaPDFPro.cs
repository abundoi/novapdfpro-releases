using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("NovaPDFPro")]
[assembly: AssemblyDescription("Enterprise-Grade Offline PDF Editor")]
[assembly: AssemblyProduct("NovaPDFPro")]
[assembly: AssemblyCompany("NovaPDFPro")]
[assembly: AssemblyVersion("1.31.0.0")]
[assembly: AssemblyFileVersion("1.31.0.0")]

namespace NovaPDFProLauncher
{
    public class Program
    {
        [STAThread]
        public static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
            string electronDist = null;
            string[] possiblePaths = new string[]
            {
                Path.Combine(appDir, "runtime", "electron.exe"),
                Path.Combine(appDir, "electron.exe"),
                Path.Combine(appDir, "node_modules", "electron", "dist", "electron.exe")
            };

            foreach (string p in possiblePaths)
            {
                if (File.Exists(p))
                {
                    electronDist = p;
                    break;
                }
            }

            string mainScript = Path.Combine(appDir, "electron", "main.cjs");

            // Check if installed in Program Files or Portable
            bool isPortable = File.Exists(Path.Combine(appDir, "portable.flag")) ||
                              Directory.Exists(Path.Combine(appDir, "data"));

            if (isPortable)
            {
                Environment.SetEnvironmentVariable("PORTABLE_EXECUTABLE_DIR", appDir);
                string portableData = Path.Combine(appDir, "data");
                if (!Directory.Exists(portableData)) Directory.CreateDirectory(portableData);
            }

            // Launch Electron if present, forwarding any opened file paths cleanly
            if (!string.IsNullOrEmpty(electronDist) && File.Exists(mainScript))
            {
                System.Text.StringBuilder argBuilder = new System.Text.StringBuilder();
                argBuilder.Append("--no-sandbox \"");
                argBuilder.Append(appDir);
                argBuilder.Append("\"");
                if (args != null && args.Length > 0)
                {
                    foreach (string rawArg in args)
                    {
                        if (!string.IsNullOrWhiteSpace(rawArg))
                        {
                            string safeArg = rawArg.Trim().Replace("\"", "");
                            argBuilder.Append(" \"");
                            argBuilder.Append(safeArg);
                            argBuilder.Append("\"");
                        }
                    }
                }

                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = electronDist,
                    Arguments = argBuilder.ToString(),
                    WorkingDirectory = appDir,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                try
                {
                    Process proc = Process.Start(psi);
                    return; // Successfully launched
                }
                catch (Exception ex)
                {
                    MessageBox.Show("Failed to launch NovaPDFPro engine: " + ex.Message, "Launch Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            }

            // Fallback status window if dependencies are verifying
            Application.Run(new ControllerForm(appDir));
        }
    }

    public class ControllerForm : Form
    {
        public ControllerForm(string appDir)
        {
            Text = "NovaPDFPro — Desktop Controller";
            Size = new Size(540, 320);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            BackColor = Color.FromArgb(9, 13, 22);
            ForeColor = Color.FromArgb(241, 245, 249);
            Font = new Font("Segoe UI", 9.5F, FontStyle.Regular);

            try
            {
                string icoPath = Path.Combine(appDir, "NovaPDFPro.ico");
                if (!File.Exists(icoPath)) icoPath = Path.Combine(appDir, "installer", "NovaPDFPro.ico");
                if (File.Exists(icoPath)) Icon = new Icon(icoPath);
            }
            catch { }

            Label titleLabel = new Label
            {
                Text = "NovaPDFPro — Offline Desktop Edition",
                Font = new Font("Segoe UI", 13F, FontStyle.Bold),
                ForeColor = Color.FromArgb(56, 189, 248),
                Location = new Point(24, 24),
                AutoSize = true
            };
            Controls.Add(titleLabel);

            Label subLabel = new Label
            {
                Text = "Standalone Offline PDF Editor • OCR • Digital Signatures • Redaction",
                Font = new Font("Segoe UI", 8.75F, FontStyle.Regular),
                ForeColor = Color.FromArgb(148, 163, 184),
                Location = new Point(24, 54),
                AutoSize = true
            };
            Controls.Add(subLabel);

            Button openBtn = new Button
            {
                Text = "Launch PDF Editor",
                Location = new Point(24, 110),
                Size = new Size(160, 38),
                BackColor = Color.FromArgb(14, 165, 233),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9.5F, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            openBtn.FlatAppearance.BorderSize = 0;
            openBtn.Click += (s, e) =>
            {
                string distIndex = Path.Combine(appDir, "dist", "index.html");
                if (File.Exists(distIndex))
                {
                    Process.Start(new ProcessStartInfo(distIndex) { UseShellExecute = true });
                }
                else
                {
                    MessageBox.Show("NovaPDFPro UI assets not found. Please verify application installation.", "Notice", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            };
            Controls.Add(openBtn);

            Button folderBtn = new Button
            {
                Text = "Open Storage Directory",
                Location = new Point(200, 110),
                Size = new Size(180, 38),
                BackColor = Color.FromArgb(30, 41, 59),
                ForeColor = Color.FromArgb(226, 232, 240),
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            folderBtn.FlatAppearance.BorderColor = Color.FromArgb(51, 65, 85);
            folderBtn.Click += (s, e) =>
            {
                string storage = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NovaPDFPro");
                if (!Directory.Exists(storage)) Directory.CreateDirectory(storage);
                Process.Start(new ProcessStartInfo("explorer.exe", storage));
            };
            Controls.Add(folderBtn);

            Label infoLabel = new Label
            {
                Text = "100% Offline Architecture: Zero cloud connectivity. All document operations execute entirely on this local device.",
                Location = new Point(24, 180),
                Size = new Size(480, 45),
                ForeColor = Color.FromArgb(100, 116, 139),
                Font = new Font("Segoe UI", 8F)
            };
            Controls.Add(infoLabel);
        }
    }
}
