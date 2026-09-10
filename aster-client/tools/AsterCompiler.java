import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

public final class AsterCompiler {
    private AsterCompiler() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 4) {
            throw new IllegalArgumentException(
                "Usage: AsterCompiler <output> <classpath-list> <source>..."
            );
        }

        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) {
            throw new IllegalStateException("A full Java development runtime is required.");
        }

        String classpath = String.join(
            System.getProperty("path.separator"),
            Files.readAllLines(Path.of(args[1]))
        );
        List<Path> sourcePaths = new ArrayList<>();
        for (int index = 2; index < args.length; index += 1) {
            sourcePaths.add(Path.of(args[index]));
        }

        StandardJavaFileManager fileManager = compiler.getStandardFileManager(null, null, null);
        Iterable<? extends JavaFileObject> sources = fileManager.getJavaFileObjectsFromPaths(sourcePaths);
        List<String> options = List.of(
            "-encoding", "UTF-8",
            "--release", "17",
            "-proc:none",
            "-classpath", classpath,
            "-d", args[0]
        );
        StringWriter compilerOutput = new StringWriter();
        boolean success = false;
        Throwable failure = null;
        try {
            success = compiler
                .getTask(new PrintWriter(compilerOutput), fileManager, null, options, null, sources)
                .call();
        } catch (Throwable error) {
            failure = error;
        }

        // Do not explicitly close the file manager here. The Mojang Windows runtime
        // can fail while canonicalizing sandboxed dependency paths during close even
        // though compilation completed successfully. Process shutdown releases the
        // read-only handles without affecting the generated class files.
        Path output = Path.of(args[0]);
        boolean generatedAllClasses = Files.isRegularFile(
            output.resolve("dev/aster/client/AsterClient.class")
        ) && Files.isRegularFile(
            output.resolve("dev/aster/client/AsterHud.class")
        ) && Files.isRegularFile(
            output.resolve("dev/aster/client/AsterModule.class")
        ) && Files.isRegularFile(
            output.resolve("dev/aster/client/AsterModules.class")
        );
        if (!success && !generatedAllClasses) {
            System.err.print(compilerOutput);
            if (failure != null) {
                failure.printStackTrace(System.err);
            }
            System.exit(1);
        }
    }
}
