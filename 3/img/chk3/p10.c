#include <pthread.h>
#include <stdio.h>
#include <semaphore.h>
#include <stdlib.h>
#include <time.h>
#include <unistd.h>
/*
implemente en C una simulación de la Asociación de Héroes de One Punch Man usando monitores.

La Asociación cuenta inicialmente con 5 héroes disponibles. Cada thread representa una amenaza que aparece 
aleatoriamente con nivel TIGRE, DEMONIO o DRAGON. En total, deben generarse 10 amenazas.

Cada amenaza requiere una cantidad distinta de héroes:

Amenaza TIGRE: requiere 1 héroe.
Amenaza DEMONIO: requiere 2 héroes.
Amenaza DRAGON: requiere 3 héroes.
Implemente un monitor AsociacionHeroes usando mutex y variables de condición. El monitor debe incluir, como mínimo:

atender_amenaza(int id, int nivel)
liberar_heroes(int id, int cantidad)
La función atender_amenaza() debe esperar si no hay suficientes héroes disponibles para atender la amenaza.

Considere imprimir los siguientes mensajes:

"Amenaza i de nivel TIGRE esperando héroes"
"Amenaza i de nivel DEMONIO siendo atendida"
"Amenaza i de nivel DRAGON siendo atendida"
"Amenaza i liberó héroes"
*/

#define NAMENAZAS 10
int heroes_dispo = 5;

int ids[NAMENAZAS];
pthread_mutex_t lock;
pthread_cond_t no_heroes_dispo;

void atender_amenaza(int id, int nivel, int heroes_requeridos, char* name){

    pthread_mutex_lock(&lock);

    while(heroes_dispo < heroes_requeridos){
        pthread_cond_wait(&no_heroes_dispo, &lock);
    }

    heroes_dispo -= heroes_requeridos;

    printf("Amenaza %d de nivel %s siendo atendida \n", id, name);

    if(heroes_dispo>0){
        pthread_cond_broadcast(&no_heroes_dispo);
    }

    pthread_mutex_unlock(&lock);

}

void liberar_heroes(int id, int cantidad){

    pthread_mutex_lock(&lock);

    heroes_dispo += cantidad;

    printf("Amenaza %d liberó %d héroes \n", id, cantidad);
    pthread_cond_broadcast(&no_heroes_dispo);

    pthread_mutex_unlock(&lock);

}

void *thread_fun(void * arg){
    int me = *((int *) arg);

    int nivel = rand() % 3;

    int heroes_requeridos = 0;
    char* name = "";

    if (nivel == 0) {
        heroes_requeridos = 1;
        name = "TIGRE";
    }
    else if (nivel == 1) {
        heroes_requeridos = 2;
        name = "DEMONIO";
    }
    else {
        heroes_requeridos = 3;
        name = "DRAGON";
    }
    printf("Amenaza %d de nivel %s esperando héroes \n", me, name);

    atender_amenaza(me, nivel, heroes_requeridos,name);
    sleep(2);
    liberar_heroes(me,heroes_requeridos);

    return NULL;
}

int main(){
    pthread_t t_id[NAMENAZAS];

    srand(time(NULL));

    pthread_mutex_init(&lock, NULL);
    pthread_cond_init(&no_heroes_dispo, NULL);

    for(int i=0; i<NAMENAZAS; i++){
        ids[i] = i;
        pthread_create(&t_id[i], NULL, thread_fun, &ids[i]);
    }

    for(int i=0; i<NAMENAZAS; i++){
        pthread_join(t_id[i], NULL);
    }

    pthread_mutex_destroy(&lock);
    pthread_cond_destroy(& no_heroes_dispo);

    return 0;
}