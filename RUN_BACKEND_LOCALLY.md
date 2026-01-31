## Предварительные требования

#### Установлены git, docker, npm
#### Установить Terraform

Ubuntu
```bash
sudo apt update
sudo apt install -y gnupg software-properties-common curl

curl -fsSL https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg

echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] \
https://apt.releases.hashicorp.com $(lsb_release -cs) main" \
| sudo tee /etc/apt/sources.list.d/hashicorp.list

sudo apt update
sudo apt install terraform
```

Проверка
```bash
terraform version
```

#### Установить AWS SAM CLI

```bash
sudo apt update
sudo apt install -y unzip curl

curl -Lo sam.zip https://github.com/aws/aws-sam-cli/releases/latest/download/aws-sam-cli-linux-x86_64.zip
unzip sam.zip -d sam-installation
sudo ./sam-installation/install
```

Проверка
```bash
sam --version
```

## Как запустить

#### Запустить DynamoDB с помощью Docker Compose
```bash
docker compose up -d
```
Проверить, что веб-консоль DynamoDB доступна по адресу
http://localhost:8001/

#### Создать таблицы

```bash
mkdir -p ./docker/dynamodb
chmod 777 ./docker/dynamodb
docker-compose up -d
```

Скрипт может вернуть ошибки или зависнуть. Это (типа) ок
```bash
cd terraform
terraform init
terraform apply -auto-approve
```

Проверить, что таблицы созданы
http://localhost:8001/

#### Запустить бэкенд
```bash
./start-local-server.sh
```