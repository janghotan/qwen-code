/*
 * Qwen Code Engineering Edition 原生启动器二进制源码
 * 用于将 CLI 快速接入系统 PATH，从任意工作目录以原生进程启动 dist/cli.js。
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>

/*
 * 检查指定路径的文件是否存在且可访问
 */
static int file_exists(const char *path) {
    struct stat st;
    return stat(path, &st) == 0;
}

int main(int argc, char *argv[]) {
    const char *cli_path = NULL;
    static const char default_repo_path[] = "/home/tan/Projects/qwen-code/dist/cli.js";

    /* 优先允许通过环境变量覆盖 CLI 打包产物路径 */
    const char *env_path = getenv("QWEN_CODE_CLI_PATH");
    if (env_path && file_exists(env_path)) {
        cli_path = env_path;
    } else if (file_exists(default_repo_path)) {
        cli_path = default_repo_path;
    } else {
        /* 若默认绝对路径不可用，尝试依据可执行文件自身位置进行相对解析 */
        char exe_buf[4096];
        ssize_t len = readlink("/proc/self/exe", exe_buf, sizeof(exe_buf) - 1);
        if (len > 0) {
            exe_buf[len] = '\0';
            char *last_slash = strrchr(exe_buf, '/');
            if (last_slash) {
                *last_slash = '\0';
                static char rel_path[4096];
                snprintf(rel_path, sizeof(rel_path), "%s/../dist/cli.js", exe_buf);
                if (file_exists(rel_path)) {
                    cli_path = rel_path;
                }
            }
        }
    }

    if (!cli_path) {
        fprintf(stderr, "Error: Could not locate Qwen Code CLI bundle (dist/cli.js).\n");
        return 1;
    }

    /* 构造传递给 node 的参数数组 */
    char **new_argv = malloc((argc + 2) * sizeof(char *));
    if (!new_argv) {
        perror("malloc");
        return 1;
    }

    new_argv[0] = "node";
    new_argv[1] = (char *)cli_path;
    for (int i = 1; i < argc; i++) {
        new_argv[i + 1] = argv[i];
    }
    new_argv[argc + 1] = NULL;

    /* 使用 execvp 直接替换当前进程映像，保持 PID、终端 TTY 控制与信号机制完整 */
    execvp("node", new_argv);
    perror("Failed to execute node");
    free(new_argv);
    return 1;
}
