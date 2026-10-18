// The extension needs an executable on Windows. This launcher gives its pipes to the node
// proxy and puts that process and Codex in a job that ends when the extension kills us.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

static class CodexWrap
{
    static int Main(string[] args)
    {
        try
        {
            string dir = AppDomain.CurrentDomain.BaseDirectory;
            var config = new JavaScriptSerializer().Deserialize<Dictionary<string, string>>(File.ReadAllText(Path.Combine(dir, "codex-launch.json")));
            var command = new StringBuilder();
            AppendArg(command, Path.Combine(dir, "codex-wrap.js"));
            foreach (string arg in args) AppendArg(command, arg);
            IntPtr job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
            var limits = new Limits();
            limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            int size = Marshal.SizeOf(typeof(Limits));
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(limits, buffer, false);
                if (!SetInformationJobObject(job, 9, buffer, (uint)size)) throw new System.ComponentModel.Win32Exception();
            }
            finally { Marshal.FreeHGlobal(buffer); }
            var info = new ProcessStartInfo(config["node"], command.ToString()) {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
            };
            info.EnvironmentVariables["WORKTABS_CODEX_PROC_ID"] = Process.GetCurrentProcess().Id.ToString();
            using (Process child = Process.Start(info))
            {
                if (!AssignProcessToJobObject(job, child.Handle)) { child.Kill(); throw new System.ComponentModel.Win32Exception(); }
                var input = Pump(Console.OpenStandardInput(), child.StandardInput.BaseStream, true);
                var output = Pump(child.StandardOutput.BaseStream, Console.OpenStandardOutput(), false);
                var error = Pump(child.StandardError.BaseStream, Console.OpenStandardError(), false);
                child.WaitForExit();
                output.Join(5000);
                error.Join(5000);
                return child.ExitCode;
            }
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }

    static Thread Pump(Stream input, Stream output, bool closeOutput)
    {
        var thread = new Thread(() => {
            try {
                var buffer = new byte[64 * 1024];
                int count;
                while ((count = input.Read(buffer, 0, buffer.Length)) > 0) {
                    output.Write(buffer, 0, count);
                    output.Flush();
                }
            } catch (IOException) { }
            catch (ObjectDisposedException) { }
            finally {
                if (closeOutput) {
                    try { output.Close(); } catch (IOException) { } catch (ObjectDisposedException) { }
                }
            }
        }) { IsBackground = true };
        thread.Start();
        return thread;
    }

    static void AppendArg(StringBuilder sb, string arg)
    {
        if (sb.Length > 0) sb.Append(' ');
        sb.Append('"');
        int slashes = 0;
        foreach (char c in arg)
        {
            if (c == '\\') { slashes++; continue; }
            sb.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
            slashes = 0;
            sb.Append(c);
        }
        sb.Append('\\', slashes * 2);
        sb.Append('"');
    }

    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits
    {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct Counters
    {
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct Limits
    {
        public BasicLimits Basic;
        public Counters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
}
