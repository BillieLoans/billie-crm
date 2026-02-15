#!/usr/bin/env python3
"""
Substitute GITHUB_TOKEN into git+https lines of requirements.txt.
Used at Docker build time so we avoid shell escaping of the token.
Usage: subst-sdk-requirements.py <secret_file> <requirements_in> <requirements_out>
"""
import sys

def main():
    if len(sys.argv) != 4:
        sys.exit("Usage: subst-sdk-requirements.py <secret_file> <requirements_in> <requirements_out>")
    secret_path, req_in, req_out = sys.argv[1], sys.argv[2], sys.argv[3]
    token = open(secret_path).read().strip()
    placeholder = "${GITHUB_TOKEN}"
    with open(req_in) as f, open(req_out, "w") as out:
        for line in f:
            s = line.strip()
            if s.startswith("git+https") and placeholder in line:
                out.write(line.replace(placeholder, token))

if __name__ == "__main__":
    main()
