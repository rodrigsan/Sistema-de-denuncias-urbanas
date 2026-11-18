pipeline {
    agent any

    environment {
        NODE_ENV = 'testing'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Instalar dependencias Backend') {
            steps {
                bat '''
                    cd backend
                    npm ci
                '''
            }
        }

        stage('Frontend - Vitest') {
            steps {
                bat '''
                    cd frontend
                    npm ci
                    npm test
                '''
            }
        }

        stage('Ejecutar pruebas BDD Cucumber') {
            steps {
                withCredentials([
                    string(credentialsId: 'jenkins-session-secret', variable: 'SESSION_SECRET'),
                ]) {
                    bat '''
                        cd backend
                        set DATABASE_URL=postgresql://test:test@localhost:5432/denuncias_test
                        npm run test:bdd
                    '''
                }
            }
        }

        stage('Archivar reportes Cucumber') {
            steps {
                archiveArtifacts artifacts: 'backend/bdd/reports/cucumber.json, backend/bdd/reports/cucumber.html', fingerprint: true
            }
        }

        stage('Publicar reporte HTML') {
            steps {
                publishHTML(target: [
                    allowMissing: false,
                    alwaysLinkToLastBuild: true,
                    keepAll: true,
                    reportDir: 'backend/bdd/reports',
                    reportFiles: 'cucumber.html',
                    reportName: 'Reporte HTML Cucumber'
                ])
            }
        }
    }

    post {
        failure {
            echo 'El pipeline fallo. Revisar la etapa indicada arriba.'
        }
        always {
            echo 'Pipeline de pruebas BDD finalizado.'
        }
    }
}
