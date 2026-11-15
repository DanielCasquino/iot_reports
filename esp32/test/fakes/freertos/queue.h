#pragma once
#include <deque>
#include <vector>
#include <cstring>
struct TestQueue {size_t max,size;std::deque<std::vector<char>> data;};
using QueueHandle_t=TestQueue*;
inline QueueHandle_t xQueueCreate(size_t n,size_t size){return new TestQueue{n,size,{}};}
inline int xQueueSend(QueueHandle_t q,const void* p,int){if(q->data.size()>=q->max)return 0;auto c=static_cast<const char*>(p);q->data.emplace_back(c,c+q->size);return 1;}
inline int xQueueReceive(QueueHandle_t q,void* p,int){if(q->data.empty())return 0;std::memcpy(p,q->data.front().data(),q->size);q->data.pop_front();return 1;}

inline int xQueuePeek(QueueHandle_t q,void* p,int){if(q->data.empty())return 0;std::memcpy(p,q->data.front().data(),q->size);return 1;}

inline int xQueueReset(QueueHandle_t q){q->data.clear();return 1;}

inline int xQueueOverwrite(QueueHandle_t q,const void* p){if(q->max!=1)return 0;q->data.clear();return xQueueSend(q,p,0);}
