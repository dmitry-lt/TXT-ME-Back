# Run SAM Local API with a custom DynamoDB endpoint.
# 1. Spins Lambdas defined in template.yaml.
# 2. Injects environment variables from locals.json (overriding DYNAMODB_URL defined in template.yaml).

# Check if the user provided "i" as the first argument
if [ "$1" == "i" ]; then
    echo "Installing dependencies in subfolders..."

    # Find package.json files at the second/third level (e.g., ./auth/User/package.json)
    # and run 'npm install' in those directories.
    find . -maxdepth 3 -name "package.json" -not -path "*/node_modules/*" | while read -r package_path; do
        dir=$(dirname "$package_path")
        echo "Updating $dir..."
        (cd "$dir" && npm install)
    done
    echo "Done with installations."
else
    echo "Skipping installation. Use './$(basename "$0") i' to install dependencies."
fi

sam local start-api --env-vars locals.json