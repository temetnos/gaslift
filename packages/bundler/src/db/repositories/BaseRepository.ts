import { Repository, FindOptionsWhere, FindManyOptions, FindOneOptions } from 'typeorm';
import { AppDataSource } from '../data-source';
import { BaseEntity } from '../entities/BaseEntity';

export abstract class BaseRepository<T extends BaseEntity> {
  protected repository: Repository<T>;

  constructor(repository: Repository<T>) {
    this.repository = repository;
  }

  async findOne(id: string): Promise<T | null> {
    return this.repository.findOne({ where: { id } as any } as FindOneOptions<T>);
  }

  async findOneBy(where: FindOptionsWhere<T>): Promise<T | null> {
    return this.repository.findOne({ where } as FindOneOptions<T>);
  }

  async findMany(options?: FindManyOptions<T>): Promise<T[]> {
    return this.repository.find(options);
  }

  async findManyBy(where: FindOptionsWhere<T>): Promise<T[]> {
    return this.repository.find({ where } as FindManyOptions<T>);
  }

  async create(data: Partial<T>): Promise<T> {
    const entity = this.repository.create(data as any);
    return this.repository.save(entity as any);
  }

  async update(id: string, data: Partial<T>): Promise<T | null> {
    await this.repository.update(id, data as any);
    return this.findOne(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.repository.delete(id);
    return result.affected ? result.affected > 0 : false;
  }

  async count(where?: FindOptionsWhere<T>): Promise<number> {
    return this.repository.count({ where } as FindManyOptions<T>);
  }

  async exists(where: FindOptionsWhere<T>): Promise<boolean> {
    const count = await this.count(where);
    return count > 0;
  }
}
